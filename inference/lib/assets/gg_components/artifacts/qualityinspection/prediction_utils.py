# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import shutil
from datetime import datetime, timezone
from os import listdir, path
from typing import List

import config_utils
import cv2
import IPCUtils as ipc_utils
import numpy as np
from ultralytics import YOLO

config_utils.logger.info("Using np from '{}'.".format(np.__file__))
config_utils.logger.info("Using cv2 from '{}'.".format(cv2.__file__))


def transform_image(im):
    if len(im.shape) == 2:
        im = np.expand_dims(im, axis=2)
        nchannels = 1
    elif len(im.shape) == 3:
        nchannels = im.shape[2]
    else:
        raise Exception("Unknown image structure")
    if nchannels == 1:
        im = cv2.cvtColor(im, cv2.COLOR_GRAY2RGB)
    elif nchannels == 4:
        im = cv2.cvtColor(im, cv2.COLOR_BGRA2RGB)
    elif nchannels == 3:
        im = cv2.cvtColor(im, cv2.COLOR_BGR2RGB)
    return im



def load_images(image_dir):
    r"""
    Validates the image type irrespective of its case. For eg. both .PNG and .png are valid image types.
    Also, accepts numpy array images.

    :param image_dir: path of the image dir on the device.
    :return: a dictionary of numpy arrays of shape (1, input_shape_x, input_shape_y, no_of_channels)
    """
    image_data = {}
    for image in listdir(image_dir):
        if image.endswith(('jpg', 'jpeg')):
            try:
                image_data[image] = cv2.imread(path.join(image_dir, image))
            except Exception as e:
                config_utils.logger.error(
                    "Unable to read the image {} at: {}. Error: {}".format(
                        image, image_dir, e))
                exit(1)
        else:
            config_utils.logger.error(
                "Images of format jpg, jpeg are only supported.")
            exit(1)
    return image_data


def predict(image_name: str, onnx_model: YOLO) -> None:
    """
    Predicts the boxes for the given image.

    :param image_name: name of the image.
    :param onnx_model: onnx model.
    :return: None
    """
    config_utils.logger.debug(f"Predicting image: {image_name}")

    payload = {}
    payload["timestamp"] = str(datetime.now(tz=timezone.utc))
    payload["image_name"] = image_name
    payload["inference_results"] = []
    boxes = []

    im2 = cv2.imread(
        f"{config_utils.INFERENCE_COMP_PATH}/qualityinspection/sample_images/{image_name}")
    results = onnx_model.predict(source=im2, conf=config_utils.SCORE_THRESHOLD)
    boxes = get_box_details(results)
    config_utils.logger.info(f"Boxes output for image: {image_name} are: {boxes}")
    
    if not is_list_empty(boxes):
        payload["inference_results"] = boxes

        if config_utils.TOPIC.strip() != "":
            ipc_utils.IPCUtils().publish_results_to_cloud(payload)
        else:
            config_utils.logger.warn(
                "No topic set to publish the inference results to the cloud.")

    else:
        config_utils.logger.warn(
            "No detections higher than {}.".format(config_utils.SCORE_THRESHOLD))
        # Upload images to S3 bucket for future labelling
        save_image_for_labeling(path.join(config_utils.IMAGE_DIR, image_name))
        ipc_utils.IPCUtils().upload_to_s3(path.join(config_utils.UPLOAD_DIR_LABELING, image_name), config_utils.UPLOAD_BUCKET_LABELING_FOLDER)


def get_box_details(results) -> List:
    box_details = [[], []]
    confidences = results[0].boxes.conf.tolist()
    coordinates = results[0].boxes.xywh.tolist()
    box_details[0].append(confidences)
    box_details[1].append(coordinates)
    return box_details


def save_image_for_labeling(image_path: str) -> None:
    image_name = image_path.split("/")[-1]
    config_utils.logger.info(f"Saving image {image_name} for S3 upload and labeling")
    dest_file_path = f"{config_utils.UPLOAD_DIR_LABELING}/{image_name}"
    shutil.copyfile(image_path, dest_file_path)
    config_utils.logger.info(f"Saved image {image_name} for S3 upload and labeling in {dest_file_path}")


def generate_bounding_box_image(image_path, detections):
    image_name = image_path.split("/")[-1]
    config_utils.logger.info("Generating bounding box image %s", image_name)
    image_data = cv2.imread(image_path)

    for coords in detections:
        cv2.rectangle(image_data, (round(coords[0]), round(coords[1])), (round(
            coords[0]+coords[2]), round(coords[1]+coords[3])), (255, 0, 0), 2)
    cv2.imwrite(config_utils.UPLOAD_BUCKET_INFERENCE_FOLDER +
                image_name, image_data)
    config_utils.logger.info("Generated bounding box image %s", image_name)


def is_list_empty(in_list: List) -> bool:
    if isinstance(in_list, list): # Is a list
        return all(map(is_list_empty, in_list))
