"use strict";

const { snapshot, boardDigest } = globalThis.LaunchRadarData;
const model = globalThis.LaunchRadar.buildModel(snapshot);
const checks = globalThis.LaunchRadar.selfChecks(model, snapshot, boardDigest);
document.querySelector("#checks").textContent = `${checks.filter(check => check.pass).length}/${checks.length} self-checks pass`;
