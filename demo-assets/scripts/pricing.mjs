import { pricing } from "./fal.mjs";
const ids = process.argv.slice(2);
const r = await pricing(ids);
console.log(r.status, JSON.stringify(r.body, null, 1));
