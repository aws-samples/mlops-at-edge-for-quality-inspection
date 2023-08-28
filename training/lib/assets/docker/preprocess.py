import argparse
import logging
import boto3
import json
import os
import json
import sagemaker
import numpy as np
import tarfile
from glob import glob
from torchvision.io import read_image
from botocore.exceptions import ClientError
from sagemaker.feature_store.feature_group import FeatureGroup
from sklearn.model_selection import train_test_split
from urllib.parse import urlparse

os.environ["AWS_DEFAULT_REGION"] = os.environ["AWS_REGION"]

s3_client = boto3.client('s3')
sagemaker_client = boto3.client("sagemaker")
sagemaker_session = sagemaker.Session()

logging.basicConfig(level=logging.INFO)

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

def parse_args():
    parser = argparse.ArgumentParser(
        description="Identify list of images with missing labels in Feature Store")

    parser.add_argument(
        "--feature-group-name",
        type=str,
        default="tag-quality-inspection",
        help="The name of the feature group where labels are stored"
    )
    parser.add_argument(
        "--query-results-s3uri",
        type=str,
        required=False,
        help="This is the s3 prefix where results from Feature Store queries should be stored"
    )
    parser.add_argument(
        "--train-output-path",
        type=str,
        default="/opt/ml/processing/output/train",
        required=False,
        help="Output directory of the training dataset which will be uploaded to S3"
    )
    parser.add_argument(
        "--validation-output-path",
        type=str,
        default="/opt/ml/processing/output/validation",
        required=False,
        help="Output directory of the validation dataset which will be uploaded to S3"
    )
    parser.add_argument(
        "--test-output-path",
        type=str,
        default="/opt/ml/processing/output/test",
        required=False,
        help="Output directory of the test dataset which will be uploaded to S3"
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

def _get_dataset(feature_group_name, query_results_s3uri):
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

def download_file(file, path):
    try:
        bucket, key, filename = split_s3_url(file)
        s3_client.download_file(bucket, key, f"{path}/{filename}")
    except ClientError as ex:
        if ex.response['Error']['Code'] == 'NoSuchKey':
            print('No object found - returning empty')
        else:
            raise
    return f"{path}/{filename}"

def split_s3_url(s3_url):
    bucket = urlparse(s3_url, allow_fragments=False).netloc
    key = urlparse(s3_url, allow_fragments=False).path[1:]
    filename = os.path.basename(urlparse(s3_url, allow_fragments=False).path)
    return bucket, key, filename

def create_yolov5_dataset(df, path):
    for i, (_, item) in enumerate(df.iterrows()):
        bucket, key, filename = split_s3_url(item['source_ref'])
        with open(f"{path}/{filename}".replace(".jpg", ".txt"), 'w+') as fw:
            if i % 100 == 0:
                logging.info(f'Writing line {i} of {len(df)}')
            file = download_file(item['source_ref'], path)
            img = read_image(file)
            annotations = json.loads(item['annotations'].replace("'", '"'))
            ids = np.array([annotation['class_id']
                           for annotation in annotations])
            boxes = np.array([[annotation['left'],
                               annotation['top'],
                               annotation['width'],
                               annotation['height']] for annotation in annotations])
            class_names = ['scratch']
            if len(boxes) > 0:
                c, h, w = img.shape
                # concat id and bboxes
                labels = np.hstack((ids.reshape(-1, 1), boxes)).astype('float')
                for label in labels:
                    # transform to YOLOv5 structure
                    b_center_x = (2 * label[1] + label[3]) / 2
                    b_center_y = (2 * label[2] + label[4]) / 2
                    b_width = label[3]
                    b_height = label[4]
                    # normalized bboxes
                    b_center_x /= float(w)
                    b_center_y /= float(h)
                    b_width /= float(w)
                    b_height /= float(h)
                    line = f"{int(label[0])} {b_center_x} {b_center_y} {b_width} {b_height}\n"
                    fw.write(line)

def create_tarball(path, filename):
    with tarfile.open(f"{path}/{filename}", "w:gz") as tarball:
        files = glob(path)
        for file in files:
            tarball.add(file, arcname=".")

def cleanup_directory(path):
    for file in glob(f"{path}/*.*"):
        if not file.endswith(".tar.gz"):
            try:
                os.remove(file)
            except OSError as e:
                print("Error: %s : %s" % (file, e.strerror))

if __name__ == "__main__":
    args = parse_args()

    os.makedirs(args.train_output_path, exist_ok=True)
    os.makedirs(args.validation_output_path, exist_ok=True)
    os.makedirs(args.test_output_path, exist_ok=True)

    logging.info(f"Started data preprocessing with args {args}")

    full_dataset = _get_dataset(
        args.feature_group_name, args.query_results_s3uri)

    # do dataset splits
    train, test = train_test_split(
        full_dataset, test_size=0.1, random_state=157)
    train, validation = train_test_split(
        train, test_size=0.2, random_state=157)

    print(f"""Split dataset. 
        Full dataset {len(full_dataset)} items, 
        Train set {len(train)} , 
        Validation set {len(validation)}, 
        Test set {len(test)}. """)

    logging.info(test.iloc[0])

    create_yolov5_dataset(train, args.train_output_path)
    create_yolov5_dataset(validation, args.validation_output_path)
    create_yolov5_dataset(test, args.test_output_path)

    create_tarball(args.train_output_path, "train.tar.gz")
    create_tarball(args.validation_output_path, "validation.tar.gz")
    create_tarball(args.test_output_path, "test.tar.gz")

    cleanup_directory(args.train_output_path)
    cleanup_directory(args.validation_output_path)
    cleanup_directory(args.test_output_path)

    logging.info("Finished data preprocessing")
