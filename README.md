# Release Tag Updater

![Master Deploy](https://github.com/sersoft-gmbh/running-release-tags-action/workflows/Master%20Deploy/badge.svg)

This action automatically updates "running release" major and major.minor tags.

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
Default: false

### `update-major`

Whether the major tag should be updated.<br/>
Default: `true`

### `update-minor`

Whether the major.minor tag should be updated.<br/>
Default: `true`

### `skip-repo-setup`

Whether the repository setup should be skipped (namely setting the `user.name` and `user.email` config parameters).<br/>
Default: `false`

## Example Usage

Use the following snippet in a Swift package repository to generate jazzy docs for all products of your Swift package:
```yaml
uses: sersoft-gmbh/running-release-tags-action@v1
with:
  tag: 1.2.3
```
