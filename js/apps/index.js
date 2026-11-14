// Every app on the home screen. To add an app, make a folder under js/apps/
// that exports:
//   { id, name, icon,          // icon = a name from js/icons.js
//     color: [from, to],       // icon tile gradient
//     dock?: true,             // show in the dock instead of the grid
//     mount(el, ctx), show?(), hide?(),
//     badge?() -> text|number, // little red bubble on the icon
//     widget?(el, ctx) }       // optional home-screen widget
// and add it to the list below.
import whiteboard from "./whiteboard/whiteboard.js";

export default [
  whiteboard,
];
