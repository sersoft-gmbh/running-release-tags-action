import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import { GitHub } from "@actions/github/lib/utils";
import { RequestError } from '@octokit/request-error';

declare type GHOctoKit = InstanceType<typeof GitHub>;

interface IReleaseParameters {
    title: string;
    body: string;
    isDraft: boolean;
}

interface IRelease {
    id: number;
    tag_name: string;
    name?: string;
    body?: string;
}

async function runCmd(cmd: string, args?: string[]): Promise<string> {
    const output = await exec.getExecOutput(cmd, args, {
        failOnStdErr: false,
        silent: !core.isDebug()
    });
    return output.stdout;
}

function getReleaseParameters(releaseType: string, isDraft: boolean): IReleaseParameters {
    return {
        title: core.getInput(`${releaseType}-release-title`, { required: true }),
        body: core.getInput(`${releaseType}-release-body`, { required: true }),
        isDraft: isDraft
    };
}

function parseTag(dryRun: boolean): (string | null) {
    const envVar = dryRun ? 'TEST_GITHUB_REF' : 'GITHUB_REF';
    const refVar = process.env[envVar];
    if (!refVar) {
        core.debug(`${envVar} is not set!`);
        return null;
    }
    const prefix = "refs/tags/";
    if (!refVar.startsWith(prefix)) {
        core.debug(`${refVar} is not a valid tag ref!`);
        return null;
    }
    return refVar.substring(prefix.length);
}

async function _getReleaseByTag(octokit: GHOctoKit, tag: string): Promise<(IRelease | null)> {
    return await octokit.rest.repos.getReleaseByTag({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        tag: tag
    })
        .then(r => r.status == 200 ? r.data as IRelease : null)
        .catch(e => {
            if (e instanceof RequestError && e.status == 404) {
                return Promise.resolve(null);
            }
            return Promise.reject(e);
        });
}

async function createReleaseIfNeeded(octokit: GHOctoKit,
                                     flag: boolean,
                                     release: (IReleaseParameters | null),
                                     tag: string,
                                     dryRun: boolean,
                                     dryRunGitHubCmd: Function) {
    if (!flag || !release) return;
    let needsRelease: boolean;
    if (!dryRun) {
        const release = await _getReleaseByTag(octokit, tag);
        needsRelease = release == null;
        core.debug(`Check if ${tag} needs a release says -> ${needsRelease}`);
    } else {
        dryRunGitHubCmd(['get-release-by-tag', tag]);
        needsRelease = true;
    }
    if (!needsRelease) return;
    function releaseText(template: string, tag: string): string {
        return template.split('${version}').join(tag);
    }

    const requestParams = {
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        target_commitish: github.context.sha,
        tag_name: tag,
        name: releaseText(release.title, tag),
        body: releaseText(release.body, tag),
        draft: release.isDraft
    }
    if (!dryRun) {
        core.debug(`Creating release for ${tag}...`);
        const response = await octokit.rest.repos.createRelease(requestParams);
        core.debug(`Created release (status ${response.status}) with id ${response.data.id}.`);
    } else {
        dryRunGitHubCmd([
            'create-release',
            requestParams.tag_name,
            requestParams.name || '',
            requestParams.body || '',
            `${requestParams.draft || false}`
        ]);
    }
}

async function main() {
    core.startGroup('Validating input');
    // undocumented - for tests.
    let executedCommands: string[] = [];
    // We cannot use `getBooleanInput` here, since it fails if not set.
    const dryRun = core.isDebug() && core.getInput('dry-run') == 'true';

    const tag = core.getInput('tag') || parseTag(dryRun);
    if (!tag) {
        throw new Error("Input `tag` was not set and `${{github.ref}}` is not a valid tag ref!");
    }

    const prefixRegex = core.getInput('prefix-regex') || '';
    const suffixRegex = core.getInput('suffix-regex') || '';
    const failOnNonSemVerTag = core.getBooleanInput('fail-on-non-semver-tag', { required: true });
    const updateMajor = core.getBooleanInput('update-major', { required: true });
    const updateMinor = core.getBooleanInput('update-minor', { required: true });
    const skipRepoSetup = core.getBooleanInput('skip-repo-setup', { required: true });

    const createRelease = core.getBooleanInput('create-release', { required: true });
    let majorRelease: (IReleaseParameters | null), minorRelease: (IReleaseParameters | null);
    if (createRelease && (updateMajor || updateMinor)) {
        const createAsDraft = core.getBooleanInput('create-release-as-draft', { required: true });
        majorRelease = updateMajor ? getReleaseParameters('major', createAsDraft) : null;
        minorRelease = updateMinor ? getReleaseParameters('minor', createAsDraft) : null;
    } else {
        majorRelease = null;
        minorRelease = null;
    }

    const updateFullRelease = core.getBooleanInput('update-full-release', { required: true });

    const githubToken = core.getInput('github-token', { required: createRelease && (updateMajor || updateMinor) });
    core.endGroup();

    function dryRunCmd(cmd: string[]) {
        const command = cmd.join(' ');
        core.debug(`Would execute: \`${command}\``);
        executedCommands.push(command);
    }

    async function dryRunGitHub(cmd: string[]) {
        dryRunCmd(['github'].concat(cmd));
    }

    async function runGit(cmd: string[]) {
        if (!dryRun) {
            await runCmd('git', cmd);
        } else {
            dryRunCmd(['git'].concat(cmd));
        }
    }

    core.startGroup('Validate version');
    const versionRegEx = new RegExp(`^${prefixRegex}[0-9]+\\.[0-9]+\\.[0-9]+${suffixRegex}$`);
    if (!versionRegEx.test(tag)) {
        const message = `Version tag '${tag}' does not match (semver) regex '${versionRegEx.source}'`;
        if (failOnNonSemVerTag) {
            throw new Error(message);
        } else {
            core.info(message);
            core.endGroup();
            return;
        }
    }
    core.endGroup();

    core.startGroup('Compose tags');
    if (!updateMajor && !updateMinor) {
        core.info("Neither `update-major` nor `update-minor` is set. Nothing to do...");
        core.endGroup();
        return;
    }
    const versionComponents = tag.split('.');
    const majorTag = versionComponents[0];
    const minorTag = `${majorTag}.${versionComponents[1]}`
    let tagsToUpdate: string[] = [];
    if (updateMajor) {
        tagsToUpdate.push(majorTag);
    }
    if (updateMinor) {
        tagsToUpdate.push(minorTag);
    }
    core.endGroup();

    if (!skipRepoSetup) {
        const userName = process.env.GITHUB_ACTOR || 'nobody';
        await core.group('Setting up repo', async () => await Promise.all([
            runGit(['config', 'user.name', userName]),
            runGit(['config', 'user.email', `${userName}@users.noreply.github.com`]),
        ]));
    }

    await core.group('Create tags', async () => await Promise.all(
        tagsToUpdate.map(t => runGit(['tag', '--force', t]))
    ));

    await core.group('Push tags', async () => await Promise.all(
        tagsToUpdate.map(t => runGit(['push', '--force', 'origin', t]))
    ));

    if (createRelease) {
        await core.group('Create releases', async () => {
            const octokit = github.getOctokit(githubToken);
            if (!dryRun) {
                await Promise.all([
                    createReleaseIfNeeded(octokit, updateMajor, majorRelease, majorTag, false, dryRunGitHub),
                    createReleaseIfNeeded(octokit, updateMinor, minorRelease, minorTag, false, dryRunGitHub),
                ]);
            } else {
                // In dry-run mode, the order of outputs matters. Promise.all doesn't guarantee any order, though.
                await createReleaseIfNeeded(octokit, updateMajor, majorRelease, majorTag, true, dryRunGitHub);
                await createReleaseIfNeeded(octokit, updateMinor, minorRelease, minorTag, true, dryRunGitHub);
            }
        });
    }

    if (updateFullRelease) {
        await core.group('Update full release', async () => {
            const octokit = github.getOctokit(githubToken);
            let release: IRelease | null;
            if (!dryRun) {
                release = await _getReleaseByTag(octokit, tag);
            } else {
                release = {
                    id: 1234,
                    tag_name: tag,
                    name: 'Dry Run Testing',
                    body: 'Dry Run Testing Body',
                };
                await dryRunGitHub(['get-release-by-tag', tag]);
            }
            if (!release) {
                throw new Error(`Could not find an existing GitHub release for tag ${tag}`);
            }

            // To mark the full release as latest, we simply update it by appending `&nbsp` and removing it again.
            const appendUpdate = {
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                release_id: release.id,
                body: (release.body ?? '') + '&nbsp;'
            };
            const restoreUpdate = {
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                release_id: release.id,
                body: release.body
            };
            if (!dryRun) {
                await octokit.rest.repos.updateRelease(appendUpdate);
                await octokit.rest.repos.updateRelease(restoreUpdate);
            } else {
                interface IReleaseUpdate {
                    owner: string;
                    repo: string;
                    release_id: number;
                    body?: string;
                }
                async function dryRunUpdate(update: IReleaseUpdate): Promise<void> {
                    await dryRunGitHub([
                        'update-release',
                        update.release_id.toString(),
                        update.body || '',
                    ]);
                }
                await dryRunUpdate(appendUpdate);
                await dryRunUpdate(restoreUpdate);
            }
        });
    }

    if (dryRun) {
        core.setOutput('executed-commands', executedCommands.join('\n'));
    }
}

try {
    main().catch(error => core.setFailed(error.message));
} catch (error: any) {
    core.setFailed(error.message);
}
