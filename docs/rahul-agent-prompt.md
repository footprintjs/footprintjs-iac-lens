# Rahul's agent: Neo deployment and synchronized Lens replay

Use the latest GitHub `main` from these repositories:

- https://github.com/footprintjs/footprintjs-iac
- https://github.com/footprintjs/footprintjs-iac-lens
- https://github.com/sanjay1909/neo-agentfootprint

Preserve Neo's existing systemd deployment. Keep automatic CI off; run checks
locally and do not dispatch GitHub workflows. Use existing checkouts when
possible. Inspect dirty/untracked work before pulling, preserve it, and use
fast-forward pulls. Never force-push, reset user work, or clear deployment state.
Record the actual commit IDs used.

Read each repository's agent instructions. In Neo, also read `CLAUDE.md`,
`infra/onboarding/README.md`, `infra/deploy-strategy/README.md`,
`infra/lens-host/README.md` and `infra/vendor/README.md`. In Lens, read
`docs/runs-ui.md`, `docs/shared-theme.md`, `docs/diagram-adapters.md` and
`docs/onboarding.md`.

1. **Install and check.** Select Node 24 for the infrastructure controller.
   Preserve Neo's configured application/Python runtimes. Set `IAC_REPO`,
   `LENS_REPO` and `NEO_REPO` to absolute paths on this laptop, then run:

   ```sh
   npm --prefix "$IAC_REPO" ci
   npm --prefix "$IAC_REPO" run check
   npm --prefix "$IAC_REPO" test
   npm --prefix "$IAC_REPO" run build
   npm --prefix "$LENS_REPO" ci
   npm --prefix "$LENS_REPO" run check
   npm --prefix "$LENS_REPO" test
   npm --prefix "$LENS_REPO" run build
   npm --prefix "$NEO_REPO" ci --include=dev
   npm --prefix "$NEO_REPO/infra" ci
   npm --prefix "$NEO_REPO/infra" test
   ```

   Run Neo's unchanged application gate in its documented environment before a
   deployment. Do not weaken gates or work around production declarations.
   Build Lens from GitHub: the npm alpha does not contain all these UI changes.
   Neo and Lens already pin the reviewed core archive in their own lockfiles;
   do not replace those dependencies with arbitrary sibling paths or npm alpha.

2. **Reuse the registered deployment owner.** Find the trusted module named by
   `SEO_DEPLOYMENT_PROFILE_MODULE` and its existing site registration, unit
   bindings, target identity and private deployment ledger. The same module
   must export `createNeoDeploymentAdapters` for Neo's existing `./deploy.sh`
   and `createOnboardingHost` for Lens. Keep its native state directory stable.
   Viewer storage is separate and cannot replace or reset that ledger.

   If this composition does not yet exist, prepare an ignored private module,
   for example `infra/.local/rahul-site.mjs`, using the documented
   `createNeoSystemdOnboarding` or `createNeoVersionedSystemdOnboarding` factory.
   `infra/onboarding/index.mjs` is an SDK factory, not a ready-made host module.
   Register actual `health`, `login`, `allowed`, `denied` and connection runners.
   Default HTTP readiness alone does not prove login or access control.
   Register the real component placement, Existing/Embedded origins and
   connection/check bindings; do not invent databases or LDAP from unit names.
   Production additionally requires the existing production declaration and
   application gate. A macOS laptop needs an approved runner to the existing
   Linux server or an isolated real Linux lab; it cannot run systemd itself.
   Keep secrets private and outside recordings and Git.

3. **Start Lens.** Set `RAHUL_PROFILE` to that trusted module's absolute path and
   `RAHUL_LENS_STATE` to persistent private viewer storage on this laptop:

   ```sh
   npm --prefix "$LENS_REPO" start -- \
     --onboarding-host "$RAHUL_PROFILE" \
     --directory "$RAHUL_LENS_STATE" \
     --port 0
   ```

   Open the printed loopback URL. Reuse the same profile with Neo's existing
   deployment door. Do not install Kubernetes, switch traffic, or create a
   competing controller for this systemd test.

4. **Perform one real reviewed deployment.** In Lens choose Recent runs → New
   run, then Discover → Configure → Verify → Review → Deploy reviewed changes.
   For a new configuration, register a new immutable version with the versioned
   factory over the same owner, then review and activate it before those steps.
   Do not rewrite an old version's digest or clear history. An identical desired
   state should report a no-op. A release-metadata change is not an application
   code upgrade; the registered runtime adapter must install and measure bytes
   before claiming an actual code upgrade.

5. **Verify both live panes.** Deployment uses the standard Explainable UI chart
   on the left; Running system uses the isometric physical diagram on the right.
   Both use the same theme and native publication. Existing dependencies stay
   Existing; app-contained state stays Embedded. Drill Provider operation →
   Registered systemd host operation to see real native stages and skips.
   Click an ordinary step to center/zoom; Step details opens its evidence and
   Fit View restores the full visible scope. Navigation must not move replay or
   run provider work. Check that nodes remain visible during live updates.
   Connection results follow actual adapter publications; do not manufacture
   checking intervals or animation for unobserved events.

6. **Verify synchronized replay.** After completion, use the single Recorded
   progress control: Start → an actual running stage → Finish. Both panes must
   show the same saved moment, without borrowing later green results. Step
   replay advances recorded observations at reading pace; it does not claim
   original execution speed. Seeking, focusing, drilling and opening evidence
   must not restart services or change the native run identity. Reopen an older
   run and confirm its history remains unchanged.

7. **Verify Neo login and access.** Require real passed health/login/allowed/
   denied and registered connection checks under Details → Setup controls &
   recorded checks. Open the verified app link, sign out/in freshly, create a
   conversation and submit a real request. With two existing authorized test
   users, verify each can read their own conversation, cannot list the other's,
   and receives 404 with `ERR_SESSION_NOT_FOUND` for a foreign transcript.
   Anonymous invocation and incorrect-password sign-in must return 401. Do not
   paste credentials into reports. `infra/acceptance/local-http.mjs` documents
   the loopback checks; production requires a target-appropriate real runner.

8. **Report the result.** Return commit IDs, startup command with secret-free
   paths, printed Lens/Neo addresses, local test results and native run identity.
   Include screenshots of live, replay and access checks. If recording, capture
   the entire run unedited and disclose seeded data or scripted model responses.
   Report missing private host configuration as a concrete setup gap, never a
   simulated success. Stop only temporary processes created for this work;
   retain the requested preview, native evidence and deployment history.

Optional failure/recovery testing must use an explicitly owned test dependency.
Run checks after the fault and confirm failed/unknown/unpromoted status. Restore
the dependency, then repeat Discover/Configure/Verify/Review/Deploy and retain
both native results. Never inject a fault into the production identity service
merely to demonstrate the UI.
