import { useAtomValue } from "@effect/atom-react";
import { mateEngineHostAtom } from "@t3tools/client-runtime/data";
import {
  PAGE_MAX_HEIGHT,
  type CallResultPage,
  type EnvironmentId,
  type PageHeight,
  type ThreadId,
} from "@t3tools/contracts";
import {
  knownPageHeights,
  linkToOpen,
  pageDocument,
  pageHeightToRecord,
  pageStandHeight,
  readPageMessage,
  themeMessage,
  type PageTheme,
} from "@t3tools/client-runtime/zerops/publishedPage";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { useMateImageRead } from "../../assets/MateImages";
import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { uuidv4 } from "../../lib/uuid";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import {
  mobilePageTheme,
  openFromTap,
  pageRequestAllowed,
  tapEnded,
  type PageTouchPoint,
} from "./publishedPage.logic";

/** How long a page's height holds still before it is the height a later view stands at. */
const PAGE_SETTLE_MS = 600;

/** The page glides to its own height as the web's frame does. */
const PAGE_GLIDE = { duration: 220, easing: Easing.out(Easing.cubic) } as const;

/**
 * Every origin passes the web view's own list, so it never hands a refused load to the system
 * browser on its own (it opens whatever its list leaves out); `pageRequestAllowed` refuses every
 * load but the page's own, and a link reaches the browser only from the person's tap.
 */
const EVERY_ORIGIN = ["*"];

/** A blob's text, once it is read; null until then. */
function useBlobText(blob: Blob | null): string | null {
  const [read, setRead] = useState<{ readonly blob: Blob; readonly text: string } | null>(null);
  useEffect(() => {
    if (blob === null) return;
    let live = true;
    const reader = new FileReader();
    reader.onload = () => {
      if (live && typeof reader.result === "string") setRead({ blob, text: reader.result });
    };
    reader.readAsText(blob);
    return () => {
      live = false;
      if (reader.readyState === FileReader.LOADING) reader.abort();
    };
  }, [blob]);
  return read !== null && read.blob === blob ? read.text : null;
}

/** The app's colours as a page reads them, held while they stay the same. */
function usePageTheme(): PageTheme {
  const { themeVariables, themeAppearance } = useAppearancePreferences();
  return useMemo(
    () => mobilePageTheme(themeVariables, themeAppearance),
    [themeVariables, themeAppearance],
  );
}

/**
 * The page in a web view: the same wrapper as the web's frame (`pageDocument`), talking to the app
 * through the web view's bridge with a token of its own. It stands at its full height, at most
 * 2000 pt, past which it scrolls inside: from its first frame at the height recorded at the nearest
 * width, so a page measured once never moves; only its very first landing starts from a modest box
 * and glides, once, to the page's height. Settled, it reports that height for later views. When the
 * page's frame loads
 * again — a navigation the wrapper refused — it is taken down; the person may show it again.
 */
function PublishedPageFrame(props: {
  readonly title: string;
  readonly html: string | null;
  readonly theme: PageTheme;
  readonly failed: boolean;
  readonly full?: boolean;
  /** The heights the page was laid out at, by width: where it stands before it says its own. */
  readonly heights?: ReadonlyArray<PageHeight>;
  /** The page settled at a height at its view's width: once per view and width. */
  readonly onMeasured?: (width: number, height: number) => void;
}) {
  const { title, html, theme, failed, full = false, heights = [], onMeasured } = props;
  const [width, setWidth] = useState<number | null>(null);
  const [token] = useState(uuidv4);
  // The page is written once, in the colours it opened with; later colours reach it as a message.
  const [opened] = useState(theme);
  const document = useMemo(
    () => (html === null ? null : pageDocument(html, opened, { kind: "native", token })),
    [html, opened, token],
  );
  const [content, setContent] = useState<number | null>(null);
  const [left, setLeft] = useState(false);
  /** Each showing of the page is a web view of its own. */
  const [showing, setShowing] = useState(0);
  /** Where the finger on the page landed; null when none is down, or more than one. */
  const touchStart = useRef<PageTouchPoint | null>(null);
  /** When the person last tapped the page; one link opens from it at most. */
  const tappedAt = useRef<number | null>(null);
  const webView = useRef<WebView>(null);

  // Before the view says its width, the window's: the phone's recorded height, from the first frame.
  const windowWidth = useWindowDimensions().width;
  const target = pageStandHeight({ content, heights, width: width ?? windowWidth });
  const height = useSharedValue(target);
  // Its first height is placed, never eased into; every height after it glides.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current) height.set(withTiming(target, PAGE_GLIDE));
    else height.set(target);
    placed.current = true;
  }, [height, target]);
  // The page's height once it holds still is what a later view stands at: once per view and width.
  const reportedAt = useRef<number | null>(null);
  useEffect(() => {
    if (full || content === null || width === null || reportedAt.current === width) return;
    const settled = setTimeout(() => {
      reportedAt.current = width;
      onMeasured?.(width, content);
    }, PAGE_SETTLE_MS);
    return () => clearTimeout(settled);
  }, [full, content, width, onMeasured]);
  const heightStyle = useAnimatedStyle(() => ({ height: height.get() }));

  useEffect(() => {
    if (theme !== opened) webView.current?.postMessage(themeMessage(theme));
  }, [theme, opened]);

  const onMessage = (event: WebViewMessageEvent) => {
    const message = readPageMessage(event.nativeEvent.data, "null", token);
    if (message === null) return;
    if (message.kind === "left") {
      setLeft(true);
      return;
    }
    if (message.kind === "height") {
      setContent(message.height);
      return;
    }
    const activated = openFromTap(tappedAt.current, Date.now());
    tappedAt.current = null;
    const url = linkToOpen(message, { fromFrame: true, focused: true, activated });
    if (url !== null) void tryOpenExternalUrl(url, "published-page");
  };
  const pointOf = (event: GestureResponderEvent): PageTouchPoint => ({
    at: Date.now(),
    x: event.nativeEvent.pageX,
    y: event.nativeEvent.pageY,
  });
  // The app sees the finger on the web view through React Native's touch events. iOS delivers them
  // over a WKWebView; on Android it is yet to be confirmed on a device that they fire over the web
  // view. If they do not, no tap is ever counted and links never open there — which fails safe.
  const touchStarted = (event: GestureResponderEvent) => {
    touchStart.current = event.nativeEvent.touches.length > 1 ? null : pointOf(event);
  };
  const touchEnded = (event: GestureResponderEvent) => {
    tappedAt.current = tapEnded(touchStart.current, pointOf(event));
    touchStart.current = null;
  };
  const touchCancelled = () => {
    touchStart.current = null;
  };

  const body =
    document !== null && !left ? (
      <View
        className="flex-1"
        onTouchStart={touchStarted}
        onTouchEnd={touchEnded}
        onTouchCancel={touchCancelled}
      >
        <WebView
          key={showing}
          ref={webView}
          accessibilityLabel={title}
          source={{ html: document }}
          originWhitelist={EVERY_ORIGIN}
          onShouldStartLoadWithRequest={pageRequestAllowed}
          onMessage={onMessage}
          javaScriptEnabled
          javaScriptCanOpenWindowsAutomatically={false}
          setSupportMultipleWindows={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          allowsLinkPreview={false}
          allowsBackForwardNavigationGestures={false}
          allowsAirPlayForMediaPlayback={false}
          dataDetectorTypes="none"
          incognito
          cacheEnabled={false}
          domStorageEnabled={false}
          thirdPartyCookiesEnabled={false}
          sharedCookiesEnabled={false}
          geolocationEnabled={false}
          mediaCapturePermissionGrantType="deny"
          mixedContentMode="never"
          setBuiltInZoomControls={false}
          // Inside only past its full height: otherwise the conversation scrolls, the page with it.
          scrollEnabled={content !== null && content > PAGE_MAX_HEIGHT}
          bounces={false}
          overScrollMode="never"
          nestedScrollEnabled
          style={{ backgroundColor: "transparent" }}
        />
      </View>
    ) : left ? (
      <View className="flex-1 items-center justify-center gap-2 px-4">
        <Text className="text-center text-sm text-foreground-muted">
          The page tried to open something else, so it was closed.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setShowing((count) => count + 1);
            setContent(null);
            setLeft(false);
          }}
          className="rounded-full border border-border px-3 py-1.5"
        >
          <Text className="font-t3-medium text-xs text-foreground">Show the page again</Text>
        </Pressable>
      </View>
    ) : failed ? (
      <View className="flex-1 items-center justify-center px-4">
        <Text className="text-center text-sm text-foreground-muted">
          The page could not be read from the Mate.
        </Text>
      </View>
    ) : (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );

  if (full) return <View className="flex-1">{body}</View>;
  const measure = (event: LayoutChangeEvent) =>
    setWidth(Math.round(event.nativeEvent.layout.width));
  return (
    // The page is the answer: on the conversation's own ground, with no card around it.
    <Animated.View
      className="overflow-hidden rounded-[14px]"
      style={heightStyle}
      onLayout={measure}
    >
      {body}
    </Animated.View>
  );
}

/**
 * A page the Mate published, in its run above its answer: its title, the page in place, and the
 * page full screen on request. Its bytes come from the Mate's asset store by the call's reference.
 */
export function PublishedPage(props: {
  readonly page: CallResultPage;
  /** Its call's engine item, where its heights are recorded. */
  readonly itemId: string | null;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const { page, itemId, environmentId, threadId } = props;
  const host = useAtomValue(mateEngineHostAtom);
  const heights = useMemo(
    () => (itemId === null ? (page.heights ?? []) : knownPageHeights(itemId, page.heights)),
    [itemId, page.heights],
  );
  const onMeasured = (width: number, content: number) => {
    if (itemId === null || host === null) return;
    const record = pageHeightToRecord({ itemId, heights, width, content });
    if (record === null) return;
    host.pages.recordHeight({
      environmentId,
      conversationId: threadId,
      itemId,
      width: record[0],
      height: record[1],
    });
  };
  const key = useMemo(
    () => ({
      environmentId,
      resource: { _tag: "media-file" as const, threadId, path: `mate-asset:${page.asset.id}` },
      rendition: "original" as const,
    }),
    [environmentId, threadId, page.asset.id],
  );
  const read = useMateImageRead(key);
  const html = useBlobText(read.kind === "ready" ? read.blob : null);
  const failed = read.kind === "failed" || (read.kind === "ready" && !read.blob);
  const theme = usePageTheme();
  const vars = useAppearancePreferences().themeVariables;
  const insets = useSafeAreaInsets();
  const [full, setFull] = useState(false);

  return (
    <View className="mb-3 gap-1.5" accessibilityLabel={page.title}>
      <View className="min-h-8 flex-row items-center gap-2 px-1">
        <Text className="flex-1 font-t3-medium text-sm text-foreground" numberOfLines={1}>
          {page.title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${page.title} full screen`}
          disabled={html === null}
          hitSlop={8}
          onPress={() => setFull(true)}
          className="h-8 w-8 items-center justify-center rounded-full"
          style={{ opacity: html === null ? 0.4 : 1 }}
        >
          <SymbolView
            name="arrow.up.left.and.arrow.down.right"
            size={14}
            tintColor={vars["--color-icon-subtle"]}
            type="monochrome"
          />
        </Pressable>
      </View>
      <PublishedPageFrame
        title={page.title}
        html={html}
        theme={theme}
        failed={failed}
        heights={heights}
        onMeasured={onMeasured}
      />
      <Modal
        visible={full}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setFull(false)}
      >
        <View className="flex-1 bg-screen" style={{ paddingBottom: insets.bottom }}>
          <View className="min-h-14 flex-row items-center gap-2 border-b border-border px-4">
            <Text className="flex-1 font-t3-bold text-base text-foreground" numberOfLines={1}>
              {page.title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
              onPress={() => setFull(false)}
              className="h-8 w-8 items-center justify-center rounded-full bg-subtle"
            >
              <SymbolView
                name="xmark"
                size={13}
                tintColor={vars["--color-icon-subtle"]}
                type="monochrome"
              />
            </Pressable>
          </View>
          {full ? (
            <PublishedPageFrame title={page.title} html={html} theme={theme} failed={failed} full />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}
