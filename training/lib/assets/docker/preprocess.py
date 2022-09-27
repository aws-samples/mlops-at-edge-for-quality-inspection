import argparse
import logging
import boto3
import json
import os
from urllib.parse import urlparse
import json
import sagemaker
from botocore.exceptions import ClientError
from sagemaker.feature_store.feature_group import FeatureGroup
from sklearn.model_selection import train_test_split
import mxnet as mx
import numpy as np

os.environ["AWS_DEFAULT_REGION"] = os.environ["AWS_REGION"]

s3 = boto3.resource('s3')
s3_client = boto3.client('s3')
sagemaker_client = boto3.client("sagemaker")
sagemaker_session = sagemaker.Session()

logging.basicConfig(level=logging.INFO)

OUTPUT_TEST_PATH = "/opt/ml/processing/output/test"
OUTPUT_TRAIN_PATH = "/opt/ml/processing/output/train"
OUTPUT_VALIDATION_PATH = "/opt/ml/processing/output/validation"
IMAGE_DOWNLOAD_PATH = "images"

FEATURE_S3URI = 'source_ref'
APPROVED_LABELS_QUERY = """
SELECT *
FROM
    (SELECT *, row_number()
        OVER (PARTITION BY source_ref
    ORDER BY event_time desc, Api_Invocation_Time DESC, write_time DESC) AS row_number
    FROM "{table}")
WHERE row_number = 1 AND status = 'APPROVED' AND NOT is_deleted 
"""

os.makedirs(OUTPUT_TRAIN_PATH, exist_ok=True)
os.makedirs(OUTPUT_TEST_PATH, exist_ok=True)
os.makedirs(OUTPUT_VALIDATION_PATH, exist_ok=True)
os.makedirs(IMAGE_DOWNLOAD_PATH, exist_ok=True)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Identify list of images with missing labels in feature store")

    parser.add_argument(
        "--feature-group-name",
        type=str,
        default="tag-quality-inspection",
        help="The name of the feature group where labels are stored"
    )
    parser.add_argument(
        "--query-results-s3uri",
        type=str,
        required=True,
        help="This is the s3 prefix where results from Feature story queries should be stored"
    )
    args = parser.parse_args()
    return args


def feature_group_exists(feature_group_name):
    try:
        response = sagemaker_client.describe_feature_group(
            FeatureGroupName=feature_group_name)
    except ClientError as error:
        if error.response['Error']['Code'] == "ResourceNotFound":
            logging.info(
                f"No feature group found with name {feature_group_name}")
            return False
    return True


def get_dataset(feature_group_name, query_results_s3uri):

    if not feature_group_exists(feature_group_name):
        return []
    feature_group = FeatureGroup(
        name=feature_group_name, sagemaker_session=sagemaker_session)
    query = feature_group.athena_query()
    query_string = APPROVED_LABELS_QUERY.format(table=query.table_name)
    logging.debug(
        f'Running query {query_string} against FeatureGroup {feature_group}')
    query.run(query_string=query_string, output_location=query_results_s3uri)
    query.wait()
    df = query.as_dataframe()
    logging.info(f"Found {len(df)} labels")
    return df


def download_file(file, path=f"{IMAGE_DOWNLOAD_PATH}/"):
    try:
        bucket, key, filename = split_s3_url(file)
        s3_client.download_file(bucket, key, f"{path}{filename}")
    except ClientError as ex:
        if ex.response['Error']['Code'] == 'NoSuchKey':
            print('No object found - returning empty')
        else:
            raise
    return f"{path}{filename}"


def split_s3_url(s3_url):
    bucket = urlparse(s3_url, allow_fragments=False).netloc
    key = urlparse(s3_url, allow_fragments=False).path[1:]
    filename = os.path.basename(urlparse(s3_url, allow_fragments=False).path)
    return bucket, key, filename


def write_line(img_path, im_shape, boxes, ids, idx):
    h, w, c = im_shape
    # for header, we use minimal length 2, plus width and height
    # with A: 4, B: 5, C: width, D: height
    A = 4
    B = 5
    C = w
    D = h

    # concat id and bboxes
    labels = np.hstack((ids.reshape(-1, 1), boxes)).astype('float')
    # normalized bboxes (recommanded)
    labels[:, (1, 3)] /= float(w)
    labels[:, (2, 4)] /= float(h)
    # flatten
    labels = labels.flatten().tolist()
    str_labels = [str(x) for x in labels]

    str_idx = [str(idx)]
    str_header = [str(x) for x in [A, B, C, D]]
    str_path = [img_path]
    line = '\t'.join(str_idx + str_header + str_labels + str_path) + '\n'
    return line


def write_lst_from_dataset(df, filename):
    with open(filename, 'w') as fw:
        for i, (_, item) in enumerate(df.iterrows()):
            if i % 100 == 0:
                logging.info(f'Writing line {i} of {len(df)}')
            filename = download_file(item['source_ref'])
            img = mx.image.imread(filename)
            annotations = json.loads(item['annotations'].replace("'", '"'))
            ids = np.array([annotation['class_id']
                           for annotation in annotations])
            boxes = np.array([[annotation['left'], annotation['top'], annotation['left']+annotation['width'],
                             annotation['top']+annotation['height']] for annotation in annotations])
            class_names = ['scratch']
            if len(boxes) > 0:
                line = write_line(filename, img.shape, boxes, ids, i)
                fw.write(line)


if __name__ == "__main__":
    args = parse_args()
    logging.info(f"preprocessing started with args {args}")

    full_dataset = get_dataset(
        args.feature_group_name, args.query_results_s3uri)

    # do dataset splits
    train, test = train_test_split(
        full_dataset, test_size=0.1, random_state=157)
    train, validation = train_test_split(
        full_dataset, test_size=0.2, random_state=157)

    # convert to lst
    print(
        f"Split dataset. Full dataset {len(full_dataset)} items, Train set {len(train)} , Validation set {len(validation)}, Test set {len(test)}. ")
    logging.info(test.iloc[0])

    write_lst_from_dataset(train, f"{OUTPUT_TRAIN_PATH}/train.lst")
    write_lst_from_dataset(test, f"{OUTPUT_TEST_PATH}/test.lst")
    write_lst_from_dataset(
        validation, f"{OUTPUT_VALIDATION_PATH}/val.lst")

    # write record-io from lst
    os.system(
        f"python3 /opt/scripts/im2rec.py {OUTPUT_TRAIN_PATH}/train.lst . --pass-through --pack-label")
    os.system(
        f"python3 /opt/scripts/im2rec.py {OUTPUT_VALIDATION_PATH}/val.lst . --pass-through --pack-label")
    os.system(
        f"python3 /opt/scripts/im2rec.py {OUTPUT_TEST_PATH}/test.lst . --pass-through --pack-label")

    logging.info("Finished check-missing-labels step")
