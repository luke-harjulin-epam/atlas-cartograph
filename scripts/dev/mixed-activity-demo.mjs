import { lifecycle } from "./lifecycle-demo.mjs";
import { isMain, reportError } from "./scenario.mjs";

if (isMain(import.meta.url)) lifecycle(process.argv.slice(2), { mixed: true }).catch(reportError);
