FROM --platform=linux/amd64  public.ecr.aws/lts/ubuntu:20.04_stable

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
RUN pip3 install pandas scikit-learn boto3 sagemaker torch torchvision onnx ultralytics
ENTRYPOINT ["python3"]
