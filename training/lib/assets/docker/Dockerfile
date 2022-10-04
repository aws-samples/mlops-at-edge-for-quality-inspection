FROM --platform=linux/amd64  public.ecr.aws/lts/ubuntu:18.04_stable

ENV DEBIAN_FRONTEND=noninteractive
RUN DEBIAN_FRONTEND=noninteractive apt-get update && \
  apt-get install -y --no-install-recommends \
  python3-dev \
  python3-distutils \
  python3-pip \
  python3-setuptools \
  python3-opencv \
  ffmpeg \
  libsm6 \
  libxext6 \
  build-essential \
  cmake \
  git \
  pkg-config
RUN pip3 install --upgrade scikit-build pip
RUN pip3 install pandas scikit-learn==0.21.3 boto3==1.19.4 sagemaker==2.66.1 mxnet==1.6.0 gluoncv
COPY im2rec.py /opt/scripts/
ENTRYPOINT ["python3"]