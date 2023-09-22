# Helper to find the next component version of a greengrassv2 component.
# Event has to contain { "ComponentName" : "MY_COMPONENT_NAME" }

import boto3
import logging
import sys
import re

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

greengrass_client = boto3.client('greengrassv2')

# see https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
SEMVER_REGEXP = "^(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)(?:-(?P<prerelease>(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+(?P<buildmetadata>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"

def find_latest_version(component_name_to_search):
    components = []
    for p in greengrass_client.get_paginator('list_components').paginate():
        components.extend(p["components"])
    for c in components:
        if c['componentName'] == component_name_to_search:
            return c['latestVersion']['componentVersion']
    return "0.0.0"

def create_next_version(latest_version):
    if not re.match(SEMVER_REGEXP, latest_version):
        raise "Invalid version format for semver"
    semver_parts = latest_version.split(".")
    last_part = semver_parts[len(semver_parts)-1]
    next_version = int(last_part) + 1
    semver_parts[len(semver_parts)-1] = str(next_version)
    return ".".join(semver_parts)

def handler(event, context):
    component_name = event["ComponentName"]
    if component_name is None:
        raise "Please pass a ComponentName key with its value"
    latest_version = find_latest_version(component_name)
    next_version = create_next_version(latest_version)
    logger.info(
        f"Next version for component '{component_name}' is '{next_version}'")
    return {"NextVersion": next_version, "LatestVersion": latest_version}

if __name__ == '__main__':
    if len(sys.argv) > 1:
        invoke_event = {"ComponentName": sys.argv[1]}
    else:
        invoke_event = {"ComponentName": "com.qualityinspection.model"}
    version = handler(invoke_event, None)
    print(version['NextVersion'])
