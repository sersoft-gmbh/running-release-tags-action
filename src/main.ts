import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import {mkdtemp, writeFile} from "fs";
import * as util from "util";
import path from "path";
import {fail} from "assert";
import {version} from "punycode";

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

function parseTag(): (string | null) {
    const ref = process.env.GITHUB_REF as string;
    const prefix = "refs/tags/";
    if (!ref || !ref.startsWith(prefix)) return null;
    return ref.substring(prefix.length);
}

async function main() {
    core.startGroup('Validating input');
    const tag = core.getInput('tag') || parseTag();
    if (!tag) {
        throw new Error("Input `tag` was not set and `${{github.ref}}` is not a valid tag ref!");
    }

    const prefixRegex = core.getInput('prefix-regex') || '';
    const suffixRegex = core.getInput('suffix-regex') || '';
    const failOnNonSemVerTag = core.getInput('fail-on-non-semver-tag', { required: true }) == 'true';
    const updateMajor = core.getInput('update-major', { required: true }) == 'true';
    const updateMinor = core.getInput('update-minor', { required: true }) == 'true';
    const skipRepoSetup = core.getInput('skip-repo-setup', { required: true }) == 'true';

    // undocumented - for tests.
    let executedCommands: string[] = [];
    const dryRun = core.isDebug() && core.getInput('dry-run') == 'true';
    core.endGroup();

    async function runGit(cmd: string[], failOnStdErr: boolean = true) {
        if (!dryRun) {
            await runCmd('git', cmd, failOnStdErr);
        } else {
            const command = ['git'].concat(cmd).join(' ');
            core.debug(`Would execute: \`${command}\``);
            executedCommands.push(command);
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
    let versionComponents = tag.split('.');
    const majorTag = versionComponents.shift() as string;
    let tagsToUpdate: string[] = [];
    if (updateMajor) {
        tagsToUpdate.push(majorTag);
    }
    if (updateMinor) {
        tagsToUpdate.push(`${majorTag}.${versionComponents.shift() as string}`);
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

    if (dryRun) {
        core.setOutput('executed-commands', executedCommands.join('\n'));
    }
}

try {
    main().catch(error => core.setFailed(error.message))
} catch (error) {
    core.setFailed(error.message);
}
