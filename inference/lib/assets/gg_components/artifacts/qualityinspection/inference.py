# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

from os import path
from threading import Thread, Timer
from time import sleep
import random
import config_utils
import IPCUtils as ipc_utils
from prediction_utils import load_images, predict
from ultralytics import YOLO


def set_configuration(config):
    r"""
    Sets a new config object with the combination of updated and default configuration as applicable.
    Calls inference code with the new config and indicates that the configuration changed.
    """
    new_config = {}


    if "ImageDirectory" in config:
        new_config["image_dir"] = config["ImageDirectory"]
    else:
        new_config["image_dir"] = config_utils.IMAGE_DIR
        config_utils.logger.info(
            "Using default image directory: {}".format(config_utils.IMAGE_DIR))

    if "InferenceInterval" in config:
        new_config["prediction_interval_secs"] = config["InferenceInterval"]
        config_utils.logger.info(
            "Setting inference interval: {}".format(
                new_config["prediction_interval_secs"]
            )
        )
    else:
        new_config["prediction_interval_secs"] = config_utils.DEFAULT_PREDICTION_INTERVAL_SECS
        config_utils.logger.info(
            "Using default inference interval: {}".format(
                config_utils.DEFAULT_PREDICTION_INTERVAL_SECS
            )
        )

    if "PublishResultsOnTopic" in config:
        config_utils.TOPIC = config["PublishResultsOnTopic"]
    else:
        config_utils.TOPIC = ""
        config_utils.logger.info(
            "Topic to publish inference results is empty.")

    new_config["images"] = load_images(new_config["image_dir"])
    model = YOLO(
        f"{config_utils.MODEL_COMP_PATH}/{config_utils.MODEL_NAME}", task='detect')
    

    # Run inference with the updated config indicating the config change.
    run_inference(new_config, True,model)

def run_inference(new_config, config_changed,model:YOLO):
    r"""
    Uses the new config to run inference.

    :param new_config: Updated config if the config changed. Else, the last updated config.
    :param config_changed: Is True when run_inference is called after setting the newly updated config.
    Is False if run_inference is called using scheduled thread as the config hasn't changed.
    """
    if config_changed:
        if config_utils.SCHEDULED_THREAD is not None:
            config_utils.SCHEDULED_THREAD.cancel()
        config_changed = False
    try:
        # pick random image from list and predict
        config_utils.logger.info(
            f"Images array {new_config['images'].keys()}")
        
        image = random.choice(list(new_config["images"].keys()))
        config_utils.logger.info(
            f"NOW PREDICTING from image {path.join(new_config['image_dir'], image)}")
        predict( image, model)
    except Exception as e:
        config_utils.logger.exception(
            "Error running the inference: {}".format(
                e)
        )

    config_utils.logger.info(f'Scheduling inference with interval: {new_config["prediction_interval_secs"]}')
    config_utils.SCHEDULED_THREAD = Timer(
        int(new_config["prediction_interval_secs"]),
        run_inference,
        [new_config, config_changed,model],
    )
    config_utils.SCHEDULED_THREAD.start()


def wait_for_config_changes():
    with config_utils.condition:
        config_utils.condition.wait()
        set_configuration(ipc.get_configuration())
    wait_for_config_changes()


ipc = ipc_utils.IPCUtils()

# Get intial configuration from the recipe and run inference for the first time.
set_configuration(ipc.get_configuration())

# Subscribe to the subsequent configuration changes
ipc.get_config_updates()

Thread(
    target=wait_for_config_changes,
    args=(),
).start()
