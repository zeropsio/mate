import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach } from "vite-plus/test";

// A server render that throws under a context provider never leaves the provider: its value stays
// current for every later render in this worker, in files that provide none of their own (a
// registry its test went on to dispose, for one). The next server render starts from the
// defaults again, so an empty one after each case puts them back.
afterEach(() => {
  renderToStaticMarkup(createElement(Fragment));
});
