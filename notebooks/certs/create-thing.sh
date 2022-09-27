#!/bin/bash 
# name of the IoT Device Thing
# change this to what you want

THING_NAME=${1:-notebook-test}
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

cd $SCRIPT_DIR

if test -f "$THING_NAME-certificate.pem.crt"; then
  echo "Thing and certs for $THING_NAME already exists, skippingt creation"
  exit 0
fi
# create the thing
aws iot create-thing --thing-name ${THING_NAME} | tee create-thing.json
 
# create and download the keys and device certificate
aws iot create-keys-and-certificate --certificate-pem-outfile ${THING_NAME}-certificate.pem.crt --public-key-outfile ${THING_NAME}-public.pem.key --private-key-outfile ${THING_NAME}-private.pem.key --set-as-active | tee create-keys-and-certificate.json
 
# create the thing policy
aws iot create-policy --policy-name ${THING_NAME}_all_access --policy-document '{"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": ["iot:*"], "Resource": ["*"]}]}'
 
# attach the certificate to the thing
CERT_ARN=$(grep 'certificateArn' create-keys-and-certificate.json | sed -r 's/^[^:]*: "(.*)",$/\1/')
aws iot attach-thing-principal --thing-name ${THING_NAME} --principal ${CERT_ARN}
 
# attach policy to the certificate
aws iot attach-policy --policy-name ${THING_NAME}_all_access --target ${CERT_ARN}
 
# download the amazon root ca
curl https://www.amazontrust.com/repository/AmazonRootCA1.pem --output AmazonRootCA1.pem
 
# find out what endpoint we need to connect to
aws iot describe-endpoint --endpoint-type iot:Data-ATS --output text