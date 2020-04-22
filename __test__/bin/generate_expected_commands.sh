#!/bin/bash

set -euo pipefail

if [ $# -ne 10 ]; then
  >&2 printf "Invalid argument count!\n"
  >&2 printf "Usage: $0 version_tag update_major update_minor skip_repo_setup create-releases create-releases-as-draft major-release-title major-release-body minor-release-title minor-release-body\n"
  exit 1
fi

MAJOR_TAG=$(printf "${1}" | awk -F'.' '{print $1}')
MINOR_TAG=$(printf "${1}" | awk -F'.' '{print $1"."$2}')
UPDATE_MAJOR=$2
UPDATE_MINOR=$3
SKIP_REPO_SETUP=$4
CREATE_RELEASES=$5

if [ "${UPDATE_MAJOR}" != "true" ] && [ "${UPDATE_MINOR}" != "true" ]; then
  printf "\n" # Empty commands from action lead to a file with a single newline.
  exit 0
fi

if [ "${SKIP_REPO_SETUP}" != "true" ]; then
  GH_USER=${GITHUB_ACTOR:-nobody}
  printf "git config user.name ${GH_USER}\n"
  printf "git config user.email ${GH_USER}@users.noreply.github.com\n"
fi

if [ "${UPDATE_MAJOR}" == "true" ]; then
  printf "git tag --force ${MAJOR_TAG}\n"
fi

if [ "${UPDATE_MINOR}" == "true" ]; then
  printf "git tag --force ${MINOR_TAG}\n"
fi

if [ "${UPDATE_MAJOR}" == "true" ]; then
  printf "git push --force origin ${MAJOR_TAG}\n"
fi

if [ "${UPDATE_MINOR}" == "true" ]; then
  printf "git push --force origin ${MINOR_TAG}\n"
fi

if [ "${CREATE_RELEASES}" == "true" ]; then
  CREATE_RELEASES_AS_DRAFT=$6
  if [ "${UPDATE_MAJOR}" == "true" ]; then
    RELEASE_TITLE=$(printf "${7}" | sed -E "s|\\\$\{version\}|${MAJOR_TAG}|g")
    RELEASE_BODY=$(printf "${8}" | sed -E "s|\\\$\{version\}|${MAJOR_TAG}|g")
    printf "github get-release-by-tag ${MAJOR_TAG}\n"
    printf "github create-release ${MAJOR_TAG} ${RELEASE_TITLE} ${RELEASE_BODY} ${CREATE_RELEASES_AS_DRAFT}\n"
  fi
  if [ "${UPDATE_MINOR}" == "true" ]; then
    RELEASE_TITLE=$(printf "${9}" | sed -E "s|\\\$\{version\}|${MINOR_TAG}|g")
    RELEASE_BODY=$(printf "${10}" | sed -E "s|\\\$\{version\}|${MINOR_TAG}|g")
    printf "github get-release-by-tag ${MINOR_TAG}\n"
    printf "github create-release ${MINOR_TAG} ${RELEASE_TITLE} ${RELEASE_BODY} ${CREATE_RELEASES_AS_DRAFT}\n"
  then
fi
