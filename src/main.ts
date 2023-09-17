import * as core from '@actions/core';
import { getExecOutput } from '@actions/exec';
import * as github from '@actions/github';
import { GitHub } from '@actions/github/lib/utils';

declare type GHOctoKit = InstanceType<typeof GitHub>;

declare type MakeLatestRelease = 'false' | 'true' | 'legacy';

interface IGHOctoKitResponse<T> {
    status: number;
    data: T;
}

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

async function runCmd(cmd: string, ...args: string[]): Promise<string> {
    const output = await getExecOutput(cmd, args.length <= 0 ? undefined : args);
    return output.stdout;
}

function getReleaseParameters(releaseType: string, isDraft: boolean): IReleaseParameters {
    return {
        title: core.getInput(`${releaseType}-release-title`, { required: true }),
        body: core.getInput(`${releaseType}-release-body`, { required: true }),
        isDraft: isDraft,
    };
}

function parseTag(dryRun: boolean): (string | null) {
    const envVar = dryRun ? 'TEST_GITHUB_REF' : 'GITHUB_REF';
    const refVar = process.env[envVar];
    if (!refVar) {
        core.debug(`${envVar} is not set!`);
        return null;
    }
    const prefix = 'refs/tags/';
    if (!refVar.startsWith(prefix)) {
        core.debug(`${refVar} is not a valid tag ref!`);
        return null;
    }
    return refVar.substring(prefix.length);
}

async function _responseOrNull<T>(promise: Promise<IGHOctoKitResponse<any>>): Promise<(T | null)> {
    try {
        let response = await promise;
        return response.status === 200 ? response.data as T : null;
    } catch (e: any) {
        if (e.hasOwnProperty('status') && e.status == 404)
            return null;
        core.debug(`Error getting release by tag: ${e}`);
        throw e;
    }
}

async function getReleaseByTag(octokit: GHOctoKit, tag: string): Promise<(IRelease | null)> {
    return await _responseOrNull(octokit.rest.repos.getReleaseByTag({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        tag: tag,
    }));
}

async function getLatestRelease(octokit: GHOctoKit): Promise<(IRelease | null)> {
    return await _responseOrNull(octokit.rest.repos.getLatestRelease({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
    }));
}

async function createReleaseIfNeeded(octokit: GHOctoKit,
                                     flag: boolean,
                                     release: (IReleaseParameters | null),
                                     tag: string,
                                     dryRun: boolean,
                                     dryRunGitHubCmd: (...args: string[]) => Promise<void>): Promise<boolean> {
    if (!flag || !release) return false;
    let needsRelease: boolean;
    if (!dryRun) {
        const release = await getReleaseByTag(octokit, tag);
        needsRelease = release == null;
        core.debug(`Check if ${tag} needs a release says -> ${needsRelease}`);
    } else {
        await dryRunGitHubCmd('get-release-by-tag', tag);
        needsRelease = true;
    }
    if (!needsRelease) return false;

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
        draft: release.isDraft,
        make_latest: 'false' as MakeLatestRelease,
    }
    if (!dryRun) {
        core.debug(`Creating release for ${tag}...`);
        const response = await octokit.rest.repos.createRelease(requestParams);
        core.debug(`Created release (status ${response.status}) with id ${response.data.id}.`);
    } else {
        await dryRunGitHubCmd(
            'create-release',
            requestParams.tag_name,
            requestParams.name || '',
            requestParams.body || '',
            `${requestParams.draft || false}`,
        );
    }
    return true;
}

async function main() {
    core.startGroup('Validating input');
    // undocumented - for tests.
    let executedCommands: string[] = [];
    // We cannot use `getBooleanInput` here, since it fails if not set.
    const dryRun = core.isDebug() && core.getInput('dry-run') == 'true';

    const tag = core.getInput('tag') || parseTag(dryRun);
    if (!tag)
        throw new Error('Input `tag` was not set and `${{github.ref}}` is not a valid tag ref!');

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

    async function dryRunCmd(cmd: string,  ...args: string[]) {
        const command = [cmd].concat(args).join(' ');
        core.debug(`Would execute: \`${command}\``);
        executedCommands.push(command);
    }

    async function dryRunGitHub(...args: string[]) {
        await dryRunCmd('github', ...args);
    }

    async function runGit(...args: string[]) {
        await (dryRun ? dryRunCmd : runCmd)('git', ...args);
    }

    core.startGroup('Validate version');
    const versionRegEx = new RegExp(`^${prefixRegex}[0-9]+\\.[0-9]+\\.[0-9]+${suffixRegex}$`);
    if (!versionRegEx.test(tag)) {
        const message = `Version tag '${tag}' does not match (semver) regex '${versionRegEx.source}'`;
        if (failOnNonSemVerTag)
            throw new Error(message);
        core.info(message);
        core.endGroup();
        return;
    }
    core.endGroup();

    core.startGroup('Compose tags');
    if (!updateMajor && !updateMinor) {
        core.info('Neither `update-major` nor `update-minor` is set. Nothing to do...');
        core.endGroup();
        return;
    }
    const versionComponents= tag.split('.');
    const majorTag= versionComponents[0];
    const minorTag= `${majorTag}.${versionComponents[1]}`
    let tagsToUpdate: string[] = [];
    if (updateMajor) tagsToUpdate.push(majorTag);
    if (updateMinor) tagsToUpdate.push(minorTag);
    core.endGroup();

    if (!skipRepoSetup) {
        const userName = process.env.GITHUB_ACTOR || 'nobody';
        await core.group('Setting up repo', async () => await Promise.all([
            runGit('config', 'user.name', userName),
            runGit('config', 'user.email', `${userName}@users.noreply.github.com`),
        ]));
    }

    await core.group('Create tags', async () => await Promise.all(
        tagsToUpdate.map(t => runGit('tag', '--force', t))
    ));
    await core.group('Push tags', async () => await Promise.all(
        tagsToUpdate.map(t => runGit('push', '--force', 'origin', t))
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
            let release: IRelease | null, latestRelease: IRelease | null;
            if (!dryRun) {
                [release, latestRelease] = await Promise.all([
                    getReleaseByTag(octokit, tag),
                    getLatestRelease(octokit),
                ]);
            } else {
                release = {
                    id: 1234,
                    tag_name: tag,
                    name: 'Dry Run Testing',
                    body: 'Dry Run Testing Body',
                };
                latestRelease = {
                    id: 4321,
                    tag_name: 'v1.2.3',
                    name: 'Dry Run Testing',
                    body: 'Dry Run Testing Body',
                };
                await dryRunGitHub('get-release-by-tag', tag);
                await dryRunGitHub('get-latest-release');
            }
            if (!release)
                throw new Error(`Could not find an existing GitHub release for tag ${tag}`);
            if (!latestRelease)
                throw new Error(`Could not find a latest GitHub release`);

            if (release.id === latestRelease.id) {
                core.info(`Release ${release.id} is already the latest release. Nothing to do...`);
                return;
            }

            // To mark the full release as latest, we simply update it by appending `&nbsp` and removing it again.
            const appendUpdate = {
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                release_id: release.id,
                body: (release.body ?? '') + '&nbsp;',
                make_latest: 'true' as MakeLatestRelease,
            };
            const restoreUpdate = {
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                release_id: release.id,
                body: release.body,
                make_latest: 'true' as MakeLatestRelease,
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
                    make_latest: MakeLatestRelease;
                }
                async function dryRunUpdate(update: IReleaseUpdate): Promise<void> {
                    await dryRunGitHub('update-release', update.release_id.toString(), update.body || '');
                }
                await dryRunUpdate(appendUpdate);
                await dryRunUpdate(restoreUpdate);
            }
        });
    }

    if (dryRun)
        core.setOutput('executed-commands', executedCommands.join('\n'));
}

try {
    main().catch(error => core.setFailed(error.message));
} catch (error: any) {
    core.setFailed(error.message);
}
