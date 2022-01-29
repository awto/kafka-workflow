import { trace } from "./kit";
import * as Fixtures from "./__fixtures__/workflows";

test("suspend and resume", async function () {
  await trace(Fixtures.suspendResumeTest);
});
