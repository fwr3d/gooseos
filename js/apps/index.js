// Every app on the home screen. To add an app, make a folder under js/apps/
// that exports:
//   { id, name, icon,          // icon = a name from js/icons.js
//     color: [from, to],       // icon tile gradient
//     dock?: true,             // show in the dock instead of the grid
//     mount(el, ctx), show?(arg), hide?(),   // arg = the part after "/" in "#app/arg"
//     badge?() -> text|number, // little red bubble on the icon
//     widget?(el, ctx),        // optional home-screen widget
//     wideWidget?, topWidget?, // full-width widget / widget above the Goose one
//     hidden?: true,           // off the home screen; opened from Settings → Hidden apps
//     start?(ctx),             // runs once at boot, for background jobs
//     agenda?(), complete?(key) } // dated items for Reminders and Today (see js/agenda.js)
// and add it to the list below.
import whiteboard from "./whiteboard/whiteboard.js";
import deadlines from "./deadlines/deadlines.js";
import milestones from "./milestones/milestones.js";
import syllabus from "./syllabus/syllabus.js";
import schedule from "./schedule/schedule.js";
import reminders from "./reminders/reminders.js";
import today from "./today/today.js";
import wallet from "./wallet/wallet.js";
import reset from "./reset/reset.js";
import grades from "./grades/grades.js";
import transfer from "./transfer/transfer.js";
import pdf from "./pdf/pdf.js";
import code from "./code/code.js";

export default [
  today,
  whiteboard,
  deadlines,
  milestones,
  syllabus,
  schedule,
  reminders,
  wallet,
  reset,
  grades,
  transfer,
  pdf,
  code,
];
