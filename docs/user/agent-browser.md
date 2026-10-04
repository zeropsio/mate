# The agent's browser

The **Browser** tab shows the browser session the agent opened inside the container. Opening the tab observes the daemon's published endpoint and opens one live stream. When the daemon publishes a new endpoint, Mate can open one new stream for it.

If opening fails or the stream closes, the viewer shows the reason and offers **Reconnect**. Click it to make one new opening attempt. Mate does not retry a failed opening automatically.

Web and desktop share this viewer. Closing the last viewer releases the stream and stops watching the endpoint. **Take over** lets you interact with the current page while the agent is driving; **Let the agent drive** gives control back.
