/**
 * The Mac's smooth live view: a ScreenCaptureKit streamer the pairing writes to
 * `$ROOT/src/view-stream.swift` and compiles into `$ROOT/bin/view-stream` when
 * the Mac has Apple's command line tools (see `macHostScript.ts`).
 *
 * The view helper (`macViewScript.ts`) runs it as its child for each stream, so
 * it records under node's Screen Recording, and passes its messages through
 * with the in-use flag added. It writes the helper's wire without that flag;
 * it exits 77 when macOS refuses the capture, and the helper falls back to its
 * own capture.
 *
 * The source has no backquote and no dollar-brace, so it sits in this module's
 * raw string unchanged; the tests compile it as written to a file.
 *
 * @module macViewStreamScript
 */

export const MAC_VIEW_STREAM_SOURCE = String.raw`// Zerops Mate's smooth live view of one app window on this Mac. Written and compiled by the
// Mate's pairing; view.mjs runs it as its child, so it records the screen under node's permission.
//
// view-stream <app: bundle id, name or .app path> [frames per second] [longest side in pixels]
//
// Writes view.mjs's wire to stdout without the in-use flag, which view.mjs adds: a JSON header
// line, then the bytes it announces. A frame only when the window's picture changed; a state when
// the app or its window is missing; a tick after a second of silence. Exits 77 when macOS refuses
// the capture, so view.mjs falls back to its own.
import AppKit
import CoreImage
import CoreMedia
import Foundation
@preconcurrency import ScreenCaptureKit

let noCaptureExit: Int32 = 77
let arguments = CommandLine.arguments
guard arguments.count >= 2, !arguments[1].isEmpty else {
  FileHandle.standardError.write(Data("usage: view-stream <app> [fps] [max side]\n".utf8))
  exit(64)
}
let wanted = arguments[1]
let fps = min(15, max(0.2, Double(arguments.count > 2 ? arguments[2] : "") ?? 10))
let maxSide = max(64, Int(arguments.count > 3 ? arguments[3] : "") ?? 1600)

func log(_ text: String) {
  FileHandle.standardError.write(Data(("view-stream: " + text + "\n").utf8))
}

// One writer: frames come from the capture queue, states and ticks from the main one.
let output = DispatchQueue(label: "io.zerops.mate.view-stream.output")
var lastSentAt = Date()

func send(_ header: [String: Any], _ bytes: Data? = nil) {
  var fields = header
  if let bytes { fields["size"] = bytes.count }
  guard var data = try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]) else { return }
  data.append(0x0a)
  if let bytes { data.append(bytes) }
  output.sync {
    FileHandle.standardOutput.write(data)
    lastSentAt = Date()
  }
}

struct Pick: Equatable {
  let id: CGWindowID
  let bounds: CGRect
}

func findApp() -> NSRunningApplication? {
  if let app = NSRunningApplication.runningApplications(withBundleIdentifier: wanted).first { return app }
  return NSWorkspace.shared.runningApplications.first { app in
    let name = app.localizedName ?? ""
    return name == wanted || name + ".app" == wanted || app.bundleURL?.path == wanted
  }
}

/// The window the view shows: the frontmost ordinary one (layer 0) the app has, on screen before
/// off it; tiny and invisible helper windows never count. The same rule as view.mjs's pickWindow.
func resolve() -> (status: String?, pick: Pick?) {
  guard let app = findApp() else { return ("no-app", nil) }
  let info = (CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]]) ?? []
  var usable: [(pick: Pick, onscreen: Bool)] = []
  for window in info {
    guard (window[kCGWindowOwnerPID as String] as? Int).map({ pid_t($0) }) == app.processIdentifier,
      (window[kCGWindowLayer as String] as? Int) == 0,
      let number = window[kCGWindowNumber as String] as? Int,
      let rawBounds = window[kCGWindowBounds as String] as? NSDictionary,
      let bounds = CGRect(dictionaryRepresentation: rawBounds),
      bounds.width > 40, bounds.height > 40
    else { continue }
    if let alpha = window[kCGWindowAlpha as String] as? Double, alpha <= 0 { continue }
    let onscreen = (window[kCGWindowIsOnscreen as String] as? Bool) ?? false
    usable.append((Pick(id: CGWindowID(number), bounds: bounds), onscreen))
  }
  let pick = usable.first(where: { $0.onscreen })?.pick ?? usable.first?.pick
  return pick == nil ? ("no-window", nil) : (nil, pick)
}

func refused(_ error: Error) -> Bool {
  let error = error as NSError
  return error.domain == SCStreamErrorDomain && error.code == SCStreamError.Code.userDeclined.rawValue
}

final class Viewer: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
  private let frames = DispatchQueue(label: "io.zerops.mate.view-stream.frames")
  private let images = CIContext()
  private let lock = NSLock()
  private var streamedBounds = CGRect.zero
  private var lastFrame: (jpeg: Data, width: Int, height: Int)?
  // Main queue only.
  private var stream: SCStream?
  private var current: Pick?
  private var generation = 0
  private var lastStatus: String?
  private var failures = 0

  /// The pixel size a window of this many points streams at: the screen's scale, longest side capped.
  private func configuration(for size: CGSize) -> SCStreamConfiguration {
    let scale = NSScreen.screens.map { $0.backingScaleFactor }.max() ?? 2
    var width = size.width * scale
    var height = size.height * scale
    let longest = max(width, height)
    if longest > CGFloat(maxSide) {
      width = width * CGFloat(maxSide) / longest
      height = height * CGFloat(maxSide) / longest
    }
    let configuration = SCStreamConfiguration()
    configuration.width = max(2, Int(width.rounded()))
    configuration.height = max(2, Int(height.rounded()))
    configuration.minimumFrameInterval = CMTime(seconds: 1 / fps, preferredTimescale: 600)
    configuration.showsCursor = false
    configuration.queueDepth = 3
    configuration.pixelFormat = kCVPixelFormatType_32BGRA
    return configuration
  }

  private func setBounds(_ bounds: CGRect) {
    lock.lock()
    streamedBounds = bounds
    lock.unlock()
  }

  private func stop() {
    generation += 1
    current = nil
    lock.lock()
    lastFrame = nil
    lock.unlock()
    guard let stream else { return }
    self.stream = nil
    stream.stopCapture { _ in }
  }

  /// Follows the app: a missing app or window is said once, another frontmost window is streamed
  /// instead, a moved window carries its new place, a resized one is streamed at its new size.
  func follow() {
    let resolved = resolve()
    guard let pick = resolved.pick else {
      stop()
      if let status = resolved.status, status != lastStatus {
        lastStatus = status
        send(["type": "state", "status": status])
      }
      return
    }
    lastStatus = nil
    guard let current, current.id == pick.id else {
      stop()
      start(pick)
      return
    }
    if current.bounds == pick.bounds { return }
    self.current = pick
    setBounds(pick.bounds)
    if current.bounds.size != pick.bounds.size, let stream {
      stream.updateConfiguration(configuration(for: pick.bounds.size)) { _ in }
    } else {
      resendLast(at: pick.bounds)
    }
  }

  private func start(_ pick: Pick) {
    current = pick
    setBounds(pick.bounds)
    let started = generation
    Task {
      do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let window = content.windows.first(where: { $0.windowID == pick.id }) else {
          let missing = NSError(
            domain: "view-stream", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "window \(pick.id) is not one ScreenCaptureKit shares"])
          DispatchQueue.main.async { self.failed(missing, generation: started) }
          return
        }
        let stream = SCStream(
          filter: SCContentFilter(desktopIndependentWindow: window),
          configuration: self.configuration(for: pick.bounds.size),
          delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: self.frames)
        try await stream.startCapture()
        DispatchQueue.main.async {
          if self.generation == started {
            self.stream = stream
            self.failures = 0
            // Resized while it started: stream it at its size now.
            if let size = self.current?.bounds.size, size != pick.bounds.size {
              stream.updateConfiguration(self.configuration(for: size)) { _ in }
            }
          } else {
            stream.stopCapture { _ in }
          }
        }
      } catch {
        DispatchQueue.main.async { self.failed(error, generation: started) }
      }
    }
  }

  private func failed(_ error: Error, generation started: Int) {
    if refused(error) {
      log("macOS refused the capture: \(error.localizedDescription)")
      exit(noCaptureExit)
    }
    guard generation == started else { return }
    log("capture stopped: \(error.localizedDescription)")
    failures += 1
    if failures >= 5 { exit(1) }
    stop()
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    DispatchQueue.main.async {
      guard stream === self.stream else { return }
      self.failed(error, generation: self.generation)
    }
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, buffer.isValid, let pixels = buffer.imageBuffer else { return }
    // ScreenCaptureKit marks a frame whose picture did not change as idle: nothing to send.
    if let attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false)
      as? [[SCStreamFrameInfo: Any]],
      let raw = attachments.first?[.status] as? Int,
      let status = SCFrameStatus(rawValue: raw), status != .complete, status != .started
    {
      return
    }
    guard
      let jpeg = images.jpegRepresentation(
        of: CIImage(cvPixelBuffer: pixels),
        colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
        options: [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.7])
    else { return }
    let width = CVPixelBufferGetWidth(pixels)
    let height = CVPixelBufferGetHeight(pixels)
    lock.lock()
    let bounds = streamedBounds
    let same = lastFrame?.jpeg == jpeg
    lastFrame = (jpeg, width, height)
    lock.unlock()
    if !same { sendFrame(jpeg, width: width, height: height, bounds: bounds) }
  }

  private func sendFrame(_ jpeg: Data, width: Int, height: Int, bounds: CGRect) {
    send(
      [
        "type": "frame", "mimeType": "image/jpeg", "width": width, "height": height,
        "bounds": ["x": bounds.minX, "y": bounds.minY, "width": bounds.width, "height": bounds.height],
      ], jpeg)
  }

  /// A window that moved shows the same picture somewhere else: the last frame again, at its new place.
  private func resendLast(at bounds: CGRect) {
    lock.lock()
    let last = lastFrame
    lock.unlock()
    if let last { sendFrame(last.jpeg, width: last.width, height: last.height, bounds: bounds) }
  }
}

// A command-line tool has to connect to the window server itself, or ScreenCaptureKit stops it
// with CGS_REQUIRE_INIT.
_ = NSApplication.shared
let viewer = Viewer()
viewer.follow()
Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in viewer.follow() }
Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in
  let silent = output.sync { Date().timeIntervalSince(lastSentAt) }
  if silent >= 1 { send(["type": "tick"]) }
}
RunLoop.main.run()
`;
