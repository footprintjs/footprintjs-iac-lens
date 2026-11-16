# Reviewed core candidate

The active core is `footprintjs-iac-0.5.0-alpha.2-onboarding-48be85eacbae.tgz`.
SHA-256: `48be85eacbae72f16db20b49916d01e77585727ab629117ce33622564b123862`.

It includes the reusable onboarding preset, recorded workflow and shared check
composition, plus the existing deployment, source, package and recovery APIs.
The lockfile pins this relative archive and its npm integrity, so a clean
checkout does not depend on another repository's local path. The `vendor/`
directory is included when Lens is packed.

This is a reviewed unpublished candidate, separate from the registry alpha.
Its source is in `footprintjs/footprintjs-iac`; source-linked onboarding context
and hashes are retained inside the archive's documentation. No credentials,
customer profiles or runtime state belong in this directory.

The unpublished Lens alpha.2 candidate also declares
`bundleDependencies: ["footprintjs-iac"]`. npm otherwise tries to resolve the
relative vendor archive before extracting an installed Lens tarball, which
fails with `ENOENT` even though the archive is present in the tarball. Bundling
retains this exact reviewed core and its required transitive dependencies in
standalone candidate packages. React, React DOM, XYFlow and the optional
explanation UI remain optional peers and are not bundled. This is temporary
candidate packaging until core alpha.2 is published and Lens can use a registry
version; it does not claim that alpha.2 has been published.

The repository continues to use the relative vendor archive and lock for
`npm ci`. Independent tarball installation is additionally qualified with a
production-only install, public core/server imports, native onboarding capture,
CLI help and optional UI export checks, with optional UI peer imports explicitly
blocked during headless verification.
