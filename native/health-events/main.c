/* Kernel wakes only. PSI's two-second window is the unprivileged kernel ABI, not a
 * health threshold. A one-shot quiet-window wake asks Mate to read recovery evidence. */
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/inotify.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc < 2) return 2;
  struct pollfd *fds = calloc((size_t)argc * 3 + 1, sizeof(*fds));
  if (!fds) return 1;
  int count = 0;
  int changes = inotify_init1(IN_NONBLOCK | IN_CLOEXEC);
  if (changes < 0) { perror("inotify"); return 1; }
  fds[count++] = (struct pollfd){ .fd = changes, .events = POLLIN };
  const char *watched[] = { "memory.events", "memory.high", "memory.max", "memory.swap.max" };
  const char *pressures[] = { "memory.pressure", "cpu.pressure", "io.pressure" };
  const char trigger[] = "some 1 2000000";
  char path[4096];
  for (int group = 1; group < argc; group++) {
    for (size_t i = 0; i < sizeof(watched)/sizeof(*watched); i++) {
      if (snprintf(path, sizeof(path), "%s/%s", argv[group], watched[i]) >= (int)sizeof(path)) return 2;
      if (inotify_add_watch(changes, path, IN_MODIFY | IN_ATTRIB | IN_DELETE_SELF | IN_MOVE_SELF) < 0)
        fprintf(stderr, "watch unavailable: %s: %s\n", watched[i], strerror(errno));
    }
    for (size_t i = 0; i < sizeof(pressures)/sizeof(*pressures); i++) {
      if (snprintf(path, sizeof(path), "%s/%s", argv[group], pressures[i]) >= (int)sizeof(path)) return 2;
      int fd = open(path, O_RDWR | O_NONBLOCK | O_CLOEXEC);
      if (fd < 0 || write(fd, trigger, sizeof(trigger)) < 0) {
        fprintf(stderr, "PSI trigger unavailable: %s: %s\n", pressures[i], strerror(errno));
        if (fd >= 0) close(fd);
        continue;
      }
      fds[count++] = (struct pollfd){ .fd = fd, .events = POLLPRI };
    }
  }
  puts("ready"); fflush(stdout);
  int pressure_active = 1; /* Also read recovery after pressure that predates registration. */
  for (;;) {
    int result = poll(fds, (nfds_t)count, pressure_active ? 2000 : -1);
    if (result < 0) { if (errno == EINTR) continue; perror("poll"); return 1; }
    int triggered = 0;
    if (fds[0].revents & POLLIN) { char events[4096]; while (read(changes, events, sizeof(events)) > 0) {} }
    for (int i = 1; i < count; i++) {
      if (fds[i].revents & (POLLERR | POLLHUP | POLLNVAL)) { fprintf(stderr, "PSI source lost\n"); return 1; }
      if (fds[i].revents & POLLPRI) triggered = 1;
    }
    if (triggered) pressure_active = 1;
    if (result == 0) {
      pressure_active = 0;
      for (int i = 1; i < count; i++) {
        char evidence[1024];
        ssize_t length = pread(fds[i].fd, evidence, sizeof(evidence) - 1, 0);
        if (length < 0) { perror("PSI read"); return 1; }
        evidence[length] = 0;
        char *average = strstr(evidence, "avg10=");
        if (average && strtod(average + 6, NULL) > 0) pressure_active = 1;
      }
    }
    if (fds[0].revents & POLLIN) pressure_active = 1;
    puts("change"); fflush(stdout);
  }
}
