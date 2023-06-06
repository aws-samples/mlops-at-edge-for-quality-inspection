# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import shutil
from datetime import datetime, timezone
from os import listdir, path

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


def predict_from_image(image, name,model):
    r"""
    Resize the image to the trained model input shape and predict using it.

    :param image: numpy array of the image passed in for inference
    """

    img_data = cv2.resize(
        image, (config_utils.SHAPE[1], config_utils.SHAPE[0]))
    img_data = cv2.dnn.blobFromImage(img_data,  crop=False)

    mean = [123.68, 116.779, 103.939]
    std = [58.393, 57.12, 57.375]
    img_data[0, 0, :] = img_data[0, 0, :]-mean[0]
    img_data[0, 0, :] = img_data[0, 0, :]/std[0]
    img_data[0, 1, :] = img_data[0, 1, :]-mean[1]
    img_data[0, 1, :] = img_data[0, 1, :]/std[1]
    img_data[0, 2, :] = img_data[0, 2, :]-mean[2]
    img_data[0, 2, :] = img_data[0, 2, :]/std[2]
    config_utils.logger.info(f"Predicting using tensors{img_data.shape}:")
    predict(img_data, name,model)


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


def predict(image_data, image_name,onnx_model :YOLO):
    PAYLOAD = {}
    PAYLOAD["timestamp"] = str(datetime.now(tz=timezone.utc))
    PAYLOAD["image_name"] = image_name
    PAYLOAD["inference_results"] = []
    boxes = []

    im2 = cv2.imread(
        f"{config_utils.INFERENCE_COMP_PATH}/qualityinspection/sample_images/{image_name}")
    results = onnx_model.predict(source=im2, conf=config_utils.SCORE_THRESHOLD)

    boxes = get_box_details(results)

    if (len(boxes[0]) > 0):
        PAYLOAD["inference_results"].append(boxes)

        if config_utils.TOPIC.strip() != "":
            ipc_utils.IPCUtils().publish_results_to_cloud(PAYLOAD)
        else:
            config_utils.logger.warn(
                "No topic set to publish the inference results to the cloud.")

        # generate_bounding_box_image(path.join(config_utils.IMAGE_DIR, image_name), detections[2])
        # save_image_for_labeling(path.join(config_utils.IMAGE_DIR, image_name))
        # ipc_utils.IPCUtils().upload_to_s3(path.join(config_utils.UPLOAD_DIR_LABELING, image_name), config_utils.UPLOAD_BUCKET_LABELING_FOLDER)
        # ipc_utils.IPCUtils().upload_to_s3(path.join(config_utils.UPLOAD_DIR_INFERENCE, image_name), config_utils.UPLOAD_BUCKET_INFERENCE_FOLDER)
    else:
        config_utils.logger.warn(
            "No detections higher than {}.".format(config_utils.SCORE_THRESHOLD))


def get_box_details(results):
    box_details = [[], []]
    confidences = results[0].boxes.conf.tolist()
    coordinates = results[0].boxes.xywh.tolist()
    box_details[0].append(confidences)
    box_details[1].append(coordinates)
    return box_details


def save_image_for_labeling(image_path):
    image_name = image_path.split("/")[-1]
    config_utils.logger.info(
        "Saving image {} for S3 upload and labeling".format(image_name))
    shutil.copyfile(image_path, "{}{}".format(
        config_utils.UPLOAD_DIR_LABELING, image_name))
    config_utils.logger.info(
        "Saved image {} for S3 upload and labeling".format(image_name))


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
