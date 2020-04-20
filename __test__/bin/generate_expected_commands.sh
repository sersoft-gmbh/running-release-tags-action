#!/bin/bash

set -euxo pipefail

if [ $# -ne 4 ]; then
  >&2 printf "Invalid argument count!\n"
  >&2 printf "Usage: $0 version_tag update_major update_minor skip_repo_setup\n"
  exit 1
fi

MAJOR_TAG=$(printf "${1}" | awk -F'.' '{print $1}')
MINOR_TAG=$(printf "${1}" | awk -F'.' '{print $1"."$2}')
UPDATE_MAJOR=$2
UPDATE_MINOR=$3

if [ "${4}" != "true" ]; then
  GH_USER=${GITHUB_ACTOR:-nobody}
  echo "git config user.name ${GH_USER}"
  echo "git config user.email ${GH_USER}@users.noreply.github.com"
fi

if [ "${UPDATE_MAJOR}" == "true" ]; then
  echo "git tag --force ${MAJOR_TAG}"
fi

if [ "${UPDATE_MINOR}" == "true" ]; then
  echo "git tag --force ${MINOR_TAG}"
fi

if [ "${UPDATE_MAJOR}" == "true" ]; then
  echo "git push --force origin ${MAJOR_TAG}"
fi

if [ "${UPDATE_MINOR}" == "true" ]; then
  echo "git push --force origin ${MINOR_TAG}"
fi
