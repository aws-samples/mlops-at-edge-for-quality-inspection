from mxnet import autograd, gluon, nd
import mxnet as mx
import warnings
import time
import os
import argparse
import io
import json
import logging
import numpy as np
import PIL.Image
import sys
import tarfile

import gluoncv as gcv
from gluoncv import data as gdata
from gluoncv import utils as gutils
from gluoncv.data.batchify import Pad, Stack, Tuple
from gluoncv.data.dataloader import RandomTransformDataLoader
from gluoncv.data.transforms.presets.yolo import (
    YOLO3DefaultTrainTransform,
    YOLO3DefaultValTransform,
)
from gluoncv.model_zoo import get_model
from gluoncv.utils import LRScheduler, LRSequential
from gluoncv.utils.metrics.coco_detection import COCODetectionMetric
from gluoncv.utils.metrics.voc_detection import VOC07MApMetric


logging.basicConfig()
logger = logging.getLogger()
logger.setLevel(logging.DEBUG)


def parse_args():

    parser = argparse.ArgumentParser(
        description="Evaluate yolo scratch detection model")

    parser.add_argument(
        "--data",
        default="/opt/ml/processing/test",
        help="Path to evaluation dataset",
    )

    parser.add_argument(
        "--model-path",
        default="/opt/ml/processing/model",
        help="Model for evaluation"
    )
    parser.add_argument(
        "--output-path",
        default="/opt/ml/processing/evaluation",
        help="ouput path where evaluation.json is written to"
    )

    parser.add_argument(
        "--gpus", type=str, default="0", help="Training with GPUs, you can specify 1,3 for example."
    )
    parser.add_argument(
        "--network",
        type=str,
        default="mobilenet1.0",
        help="Base network name which serves as feature extraction base.",
    )
    parser.add_argument(
        "--data-shape",
        type=int,
        default=416,
        help="Input data shape for evaluation, use 320, 416, 608... "
        + "Training is with random shapes from (320 to 608).",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=1,
        help="Input data shape for evaluation, use 320, 416, 608... "
        + "Training is with random shapes from (320 to 608).",
    )
    parser.add_argument(
        "--num-workers",
        "-j",
        dest="num_workers",
        type=int,
        default=1,
        help="Number of data workers, you can use larger "
        "number to accelerate data loading, if you CPU and GPUs are powerful.",
    )
    args = parser.parse_args()
    return args


def untar(fname, model_dir="."):
    if fname.endswith("tar.gz"):
        tar = tarfile.open(fname, "r:gz")
        tar.extractall(model_dir)
        tar.close()


def get_dataset(dataset, args):

    dataset = gdata.RecordFileDetection(
        os.path.join(dataset))
    object_categories = [
        "scratch",
    ]
    val_metric = VOC07MApMetric(iou_thresh=0.5, class_names=object_categories)
    args.no_random_shape = True

    num_samples = len(dataset)
    return dataset, val_metric


def get_dataloader(dataset, data_shape, batch_size, num_workers):
    """Get dataloader."""
    width, height = data_shape, data_shape
    val_batchify_fn = Tuple(Stack(), Pad(pad_val=-1))
    loader = gluon.data.DataLoader(
        dataset.transform(YOLO3DefaultValTransform(width, height)),
        batch_size,
        False,
        batchify_fn=val_batchify_fn,
        last_batch="keep",
        num_workers=num_workers,
    )
    return loader


def validate(net, val_data, ctx, eval_metric):
    """Test on validation dataset."""
    eval_metric.reset()
    # set nms threshold and topk constraint
    #net.set_nms(nms_thresh=0.45, nms_topk=400)
    mx.nd.waitall()
    net.hybridize()

    for i, batch in enumerate(val_data):
        logger.info(f"Working on batch {i} ")

        data = gluon.utils.split_and_load(
            batch[0], ctx_list=ctx, batch_axis=0, even_split=False)
        label = gluon.utils.split_and_load(
            batch[1], ctx_list=ctx, batch_axis=0, even_split=False)
        det_bboxes = []
        det_ids = []
        det_scores = []
        gt_bboxes = []
        gt_ids = []
        gt_difficults = []
        for x, y in zip(data, label):
            # get prediction results
            ids, scores, bboxes = net(x)
            det_ids.append(ids)
            det_scores.append(scores)
            # clip to image size
            det_bboxes.append(bboxes.clip(0, batch[0].shape[2]))
            # split ground truths
            gt_ids.append(y.slice_axis(axis=-1, begin=4, end=5))
            gt_bboxes.append(y.slice_axis(axis=-1, begin=0, end=4))
            gt_difficults.append(y.slice_axis(
                axis=-1, begin=5, end=6) if y.shape[-1] > 5 else None)

        # update metric
        eval_metric.update(det_bboxes, det_ids, det_scores,
                           gt_bboxes, gt_ids, gt_difficults)

        eval_stats = dict(
            x_bboxes=det_bboxes,
            x_ids=det_ids,
            x_scores=det_scores,
            y_bboxes=gt_bboxes,
            y_ids=gt_ids

        )

    #logger.info(f"First result was det_bboxes:{det_bboxes[0]} det_ids:{det_ids[0]} det_scores:{det_scores[0]}" )
    return eval_metric.get(), eval_stats


if __name__ == "__main__":
    args = parse_args()
    logger.info(f'Kicked off evaluation with {args}')
    model_dir = "model"

    ctx = [mx.cpu()]

    model_path = f"{args.model_path}/model.tar.gz"
    logger.info(f"Loading model from path {model_path}")
    untar(model_path, model_dir=".")
    net = mx.gluon.nn.SymbolBlock.imports(
        f"model-symbol.json", ['data'], f"model-0000.params", ctx=ctx)

    logger.info(f"Loading data from path {args.data}/test.rec")
    dataset, eval_metric = get_dataset(f"{args.data}/test.rec", args)
    data = get_dataloader(
        dataset, args.data_shape, args.batch_size, args.num_workers
    )
    metric, predictions = validate(net, data, ctx, eval_metric)
    evaluation_result = {"metrics": {"map": metric[-1][-1]}}
    logger.info(
        f"Writing following output Map:{json.dumps(evaluation_result)} to {args.output_path}/evaluation.json")
    with open(f"{args.output_path}/evaluation.json", 'w') as outfile:
        json.dump(evaluation_result, outfile)
