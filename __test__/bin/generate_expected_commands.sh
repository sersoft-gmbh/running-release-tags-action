#!/bin/bash

set -euo pipefail

if [ $# -ne 11 ]; then
  >&2 echo 'Invalid argument count!'
  >&2 echo "Usage: ${0} version_tag update_major update_minor skip_repo_setup create-releases create-releases-as-draft update-full-release major-release-title major-release-body minor-release-title minor-release-body"
  exit 1
fi

TAG="${1}"
MAJOR_TAG=$(echo -en "${TAG}" | awk -F'.' '{print $1}')
MINOR_TAG=$(echo -en "${TAG}" | awk -F'.' '{print $1"."$2}')
UPDATE_MAJOR=$2
UPDATE_MINOR=$3
SKIP_REPO_SETUP=$4
CREATE_RELEASES=$5
CREATE_RELEASES_AS_DRAFT=$6
UPDATE_FULL_RELEASE=$7

if [ "${UPDATE_MAJOR}" != 'true' ] && [ "${UPDATE_MINOR}" != 'true' ]; then
  echo -en '\n' # Empty commands from action lead to a file with a single newline.
  exit 0
fi

if [ "${SKIP_REPO_SETUP}" != 'true' ]; then
  GH_USER=${GITHUB_ACTOR:-nobody}
  echo "git config user.name ${GH_USER}"
  echo "git config user.email ${GH_USER}@users.noreply.github.com"
fi

if [ "${UPDATE_MAJOR}" == 'true' ]; then
  echo "git tag --force ${MAJOR_TAG}"
fi

if [ "${UPDATE_MINOR}" == 'true' ]; then
  echo "git tag --force ${MINOR_TAG}"
fi

if [ "${UPDATE_MAJOR}" == 'true' ]; then
  echo "git push --force origin ${MAJOR_TAG}"
fi

if [ "${UPDATE_MINOR}" == 'true' ]; then
  echo "git push --force origin ${MINOR_TAG}"
fi

if [ "${CREATE_RELEASES}" == 'true' ]; then
  if [ "${UPDATE_MAJOR}" == 'true' ]; then
    RELEASE_TITLE=$(echo -en "${8}" | sed -E "s|\\\$\{version\}|${MAJOR_TAG}|g")
    RELEASE_BODY=$(echo -en "${9}" | sed -E "s|\\\$\{version\}|${MAJOR_TAG}|g")
    echo "github get-release-by-tag ${MAJOR_TAG}"
    echo "github create-release ${MAJOR_TAG} ${RELEASE_TITLE} ${RELEASE_BODY} ${CREATE_RELEASES_AS_DRAFT}"
  fi
  if [ "${UPDATE_MINOR}" == 'true' ]; then
    RELEASE_TITLE=$(echo -en "${10}" | sed -E "s|\\\$\{version\}|${MINOR_TAG}|g")
    RELEASE_BODY=$(echo -en "${11}" | sed -E "s|\\\$\{version\}|${MINOR_TAG}|g")
    echo "github get-release-by-tag ${MINOR_TAG}"
    echo "github create-release ${MINOR_TAG} ${RELEASE_TITLE} ${RELEASE_BODY} ${CREATE_RELEASES_AS_DRAFT}"
  fi
fi

if [ "${UPDATE_FULL_RELEASE}" == 'true' ]; then
  echo "github get-release-by-tag ${TAG}"
  echo 'github get-latest-release'
  echo 'github update-release 1234 Dry Run Testing Body&nbsp;'
  echo 'github update-release 1234 Dry Run Testing Body'
fi
