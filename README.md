# Release Tag Updater

[![Tests](https://github.com/sersoft-gmbh/running-release-tags-action/actions/workflows/tests.yml/badge.svg)](https://github.com/sersoft-gmbh/running-release-tags-action/actions/workflows/tests.yml)

This action automatically updates "running release" major and major.minor tags and GitHub releases.

## Inputs

### `tag`

The tag to use for generating the other tags.<br/>
If not set, the action will attempt to parse it from `${{github.ref}}`.<br/>
If neither `tag` is set, nor `${{github.ref}}` is a valid tag ref, the action throws an error.<br/>
Note that passing `${{github.ref}}` directly to this input will **not** work!

### `prefix-regex`

The regex that is used to match allowed tag prefixes.<br/>
Default: `'v?'`

### `suffix-regex`

The regex that is used to match allowed tag suffixes.<br/>
Default: `''`
    
### `fail-on-non-semver-tag`

Whether the action should fail on non-semver compatible tags. If `false`, it simply writes a log messages and exists gracefully.<br/>
Default: `false`

### `update-major`

Whether the major tag should be updated.<br/>
Default: `true`

### `update-minor`

Whether the major.minor tag should be updated.<br/>
Default: `true`

### `skip-repo-setup`

Whether the repository setup should be skipped (namely setting the `user.name` and `user.email` config parameters).<br/>
Default: `false`

### `create-release`

Whether a corresponding GitHub release should be created.<br/>
Default: `true`

### `create-release-as-draft`:

Whether to create the GitHub releases as draft.<br/>
Default: `false`

### `major-release-title`

The title of the major release. The placeholder `${version}` is replaced by the major tag name.<br/>
Default: `'${version} Major Release Track'`

### `major-release-body`

The body of the major release. The placeholder `${version}` is replaced by the major tag name.<br/>
Default: `'This release tracks the latest ${version} major release (${version}.x.y).'`

### `minor-release-title`

The title of the minor release. The placeholder `${version}` is replaced by the minor tag name.<br/>
Default: `'${version} Minor Release Track'`

### `minor-release-body`

The body of the minor release. The placeholder `${version}` is replaced by the minor tag name.<br/>
Default: `'This release tracks the latest ${version} minor release (${version}.x).'`

### `update-full-release`

Whether to update the full release (for `tag`) to mark it as latest release.<br/>
This is useful if the release for `tag` should remain the "Latest Release" even though the major / minor releases tracks created by this action are actually created / updated _after_ the initial release.<br/>
Note that if `github-token` is **not** `${{secrets.GITHUB_TOKEN}}` but rather a personal access token (PAT) instead, this can lead to workflow run cycles if this action is run when a release is edited/updated!<br/>
Also note that since version 3.0.0 of this action, this input might not be needed since creating releases will include `"make_latest": false` in the body. The action automatically checks for the latest release and only performs an update if needed.<br/>
Default: `false`

### `github-token`

The token with which to authenticate against GitHub. Only required if releases should be created. Can also be set to `${{secrets.GITHUB_TOKEN}}`.<br/>
Default: `${{github.token}}`

## Example Usage

Use the following snippet to create a major and minor release for the tag `1.2.3`:
```yaml
uses: sersoft-gmbh/running-release-tags-action@v3
with:
  tag: 1.2.3
```
