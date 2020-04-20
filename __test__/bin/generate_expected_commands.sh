#!/bin/bash

set -euo pipefail

if [ $# -ne 4 ]; then
  >&2 printf "Invalid argument count!\n"
  >&2 printf "Usage: $0 version_tag update_major update_minor skip_repo_setup\n"
  exit 1
fi

MAJOR_TAG=$(printf "${1}" | awk -F'.' '{print $1}')
MINOR_TAG=$(printf "${1}" | awk -F'.' '{print $1"."$2}')
UPDATE_MAJOR=$2
UPDATE_MINOR=$3

if [ "${UPDATE_MAJOR}" != "true" ] && [ "${UPDATE_MINOR}" != "true" ]; then
  exit 0
fi

if [ "${4}" != "true" ]; then
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
