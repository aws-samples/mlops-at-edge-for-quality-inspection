# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import logging
import sys
from os import environ, path, makedirs
from threading import Condition
from datetime import datetime
from awsiot.greengrasscoreipc.model import QOS
dt = datetime.now().strftime('%Y-%m-%d-%H-%M-%S')

SCORE_THRESHOLD = 0.7
MAX_NO_OF_RESULTS = 5
SHAPE = (300, 450)
QOS_TYPE = QOS.AT_LEAST_ONCE
TIMEOUT = 10

# Intialize all the variables with default values
DEFAULT_PREDICTION_INTERVAL_SECS = 3600
SCHEDULED_THREAD = None
TOPIC = ""

condition = Condition()

STREAM_NAME = "S3UploadStream"
UPLOAD_BUCKET_NAME = path.expandvars(environ.get("IMAGE_UPLOAD_BUCKET"))
UPLOAD_BUCKET_LABELING_FOLDER = "pipeline/labeling/images/{}/".format(dt)
UPLOAD_BUCKET_INFERENCE_FOLDER = "inference/{}/".format(dt)
UPLOAD_DIR_INFERENCE = "{}/inference/{}/".format(path.expandvars(environ.get("UPLOAD_DIR")), dt)
UPLOAD_DIR_LABELING = "{}/labeling/{}/".format(path.expandvars(environ.get("UPLOAD_DIR")), dt)
makedirs(UPLOAD_DIR_INFERENCE, exist_ok=True)
makedirs(UPLOAD_DIR_LABELING, exist_ok=True)
IMAGE_DIR = path.expandvars(environ.get("IMAGE_DIR"))
INFERENCE_COMP_PATH = path.expandvars(environ.get("INFERENCE_COMP_PATH"))
MODEL_COMP_PATH = path.expandvars(environ.get("MODEL_COMP_PATH"))
MODEL_NAME = path.expandvars(environ.get("MODEL_NAME"))

logger = logging.getLogger()
handler = logging.StreamHandler(sys.stdout)
logger.setLevel(logging.INFO)
logger.addHandler(handler)
