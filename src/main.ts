import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import { Octokit } from '@octokit/rest';
import {RequestOptions} from "https";

interface IReleaseParameters {
    title: string;
    body: string;
    isDraft: boolean;
}

async function runCmd(cmd: string, args?: string[], failOnStdErr: boolean = true): Promise<string> {
    let stdOut = '';
    await exec.exec(cmd, args, {
        failOnStdErr: failOnStdErr,
        listeners: {
            stdout: (data: Buffer) => stdOut += data.toString()
        }
    });
    return stdOut;
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
    const ref = refVar as string;
    const prefix = "refs/tags/";
    if (!ref.startsWith(prefix)) {
        core.debug(`${ref} is not a valid tag ref!`);
        return null;
    }
    return ref.substring(prefix.length);
}

async function main() {
    core.startGroup('Validating input');
    // undocumented - for tests.
    let executedCommands: string[] = [];
    const dryRun = core.isDebug() && core.getInput('dry-run') == 'true';

    const tag = core.getInput('tag') || parseTag(dryRun);
    if (!tag) {
        throw new Error("Input `tag` was not set and `${{github.ref}}` is not a valid tag ref!");
    }

    const prefixRegex = core.getInput('prefix-regex') || '';
    const suffixRegex = core.getInput('suffix-regex') || '';
    const failOnNonSemVerTag = core.getInput('fail-on-non-semver-tag', { required: true }) == 'true';
    const updateMajor = core.getInput('update-major', { required: true }) == 'true';
    const updateMinor = core.getInput('update-minor', { required: true }) == 'true';
    const skipRepoSetup = core.getInput('skip-repo-setup', { required: true }) == 'true';

    const createRelease = core.getInput('create-release', { required: true }) == 'true';
    let majorRelease: (IReleaseParameters | null), minorRelease: (IReleaseParameters | null);
    if (createRelease && (updateMajor || updateMinor)) {
        const createAsDraft = core.getInput('create-release-as-draft', { required: true }) == 'true';
        majorRelease = updateMajor ? getReleaseParameters('major', createAsDraft) : null;
        minorRelease = updateMinor ? getReleaseParameters('minor', createAsDraft) : null;
    } else {
        majorRelease = null;
        minorRelease = null;
    }

    const githubToken = core.getInput('github-token', { required: createRelease && (updateMajor || updateMinor) });
    core.endGroup();

    function dryRunCmd(cmd: string[]) {
        const command = cmd.join(' ');
        core.debug(`Would execute: \`${command}\``);
        executedCommands.push(command);
    }

    async function runGit(cmd: string[]) {
        if (!dryRun) {
            await runCmd('git', cmd, false);
        } else {
            dryRunCmd(['git'].concat(cmd));
        }
    }

    core.startGroup('Validate version');
    const versionRegEx = new RegExp(`^${prefixRegex}[0-9]+\\.[0-9]+\\.[0-9]+${suffixRegex}$`);
    if (!versionRegEx.test(tag)) {
        const message = `Version tag ${tag} does not match (semver) regex ${versionRegEx.source}`;
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
            const octokit = new github.GitHub(githubToken);
            async function createReleaseIfNeeded(flag: boolean, release: (IReleaseParameters | null), tag: string) {
                if (!flag || !release) return;
                let needsRelease: boolean;
                if (!dryRun) {
                    needsRelease = await octokit.repos.getReleaseByTag({
                        owner: github.context.repo.owner,
                        repo: github.context.repo.repo,
                        tag: tag
                    }).then(r => r.status != 200).catch(e => e.number == 404);
                } else {
                    dryRunCmd(['github', 'get-release-by-tag', tag]);
                    needsRelease = true;
                }
                if (!needsRelease) return;
                function releaseText(template: string, tag: string): string {
                    return template.split('${version}').join(tag);
                }
                const requestParams: (RequestOptions & Octokit.ReposCreateReleaseParams) = {
                    owner: github.context.repo.owner,
                    repo: github.context.repo.repo,
                    target_commitish: github.context.sha,
                    tag_name: tag,
                    name: releaseText(release.title, tag),
                    body: releaseText(release.body, tag),
                    draft: release.isDraft
                };
                if (!dryRun) {
                    await octokit.repos.createRelease(requestParams);
                } else {
                    dryRunCmd([
                        'github', 'create-release',
                        requestParams.tag_name,
                        requestParams.name || '',
                        requestParams.body || '',
                        `${requestParams.draft || false}`
                    ]);
                }
            }
            if (!dryRun) {
                await Promise.all([
                    createReleaseIfNeeded(updateMajor, majorRelease, majorTag),
                    createReleaseIfNeeded(updateMinor, minorRelease, minorTag),
                ]);
            } else {
                // In dry-run mode, the order of outputs matters. Promise.all doesn't guarantee any order, though.
                await createReleaseIfNeeded(updateMajor, majorRelease, majorTag);
                await createReleaseIfNeeded(updateMinor, minorRelease, minorTag);
            }
        });
    }

    if (dryRun) {
        core.setOutput('executed-commands', executedCommands.join('\n'));
    }
}

try {
    main().catch(error => core.setFailed(error.message))
} catch (error) {
    core.setFailed(error.message);
}
