# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import logging
import sys
from os import environ, path, makedirs
from threading import Condition
from datetime import datetime
from awsiot.greengrasscoreipc.model import QOS
dt = datetime.now().strftime('%Y-%m-%d-%H-%M-%S')

# Set all the constants
SCORE_THRESHOLD = 0.3
MAX_NO_OF_RESULTS = 5
SHAPE = (300, 450)
QOS_TYPE = QOS.AT_LEAST_ONCE
TIMEOUT = 10

# Class label
CLASS_LABEL = 0

# Intialize all the variables with default values
DEFAULT_PREDICTION_INTERVAL_SECS = 3600
SCHEDULED_THREAD = None
TOPIC = ""

condition = Condition()

# S3 upload config
STREAM_NAME = "S3UploadStream"
UPLOAD_BUCKET_NAME = path.expandvars(environ.get("INFERENCE_IMAGE_UPLOAD_BUCKET"))
UPLOAD_BUCKET_LABELING_FOLDER = "pipeline/labeling/images/{}/".format(dt)
UPLOAD_BUCKET_INFERENCE_FOLDER = "inference/{}/".format(dt)
UPLOAD_DIR_INFERENCE = "{}inference/{}/".format(path.expandvars(environ.get("UPLOAD_DATA_DIR")), dt)
UPLOAD_DIR_LABELING = "{}labeling/{}/".format(path.expandvars(environ.get("UPLOAD_DATA_DIR")), dt)
makedirs(UPLOAD_DIR_INFERENCE, exist_ok=True)
makedirs(UPLOAD_DIR_LABELING, exist_ok=True)

# Get a logger
logger = logging.getLogger()
handler = logging.StreamHandler(sys.stdout)
logger.setLevel(logging.INFO)
logger.addHandler(handler)

# Get the model directory and images directory from the env variables.
IMAGE_DIR = path.expandvars(environ.get("DEFAULT_SMEM_OD_IMAGE_DIR"))
MODEL_DIR = path.expandvars(environ.get("SMEM_OD_MODEL_DIR"))

# Get sagemaker edge manager config
MODEL_NAME = "yolo"
tensor_name = "data"
tensor_shape = [1, 3, 300, 450]

agent_client = None
edge_agent_component_name = "aws.greengrass.SageMakerEdgeManager"
edge_agent_socket_change = True
inference_component_name = "com.qualityinspection"
