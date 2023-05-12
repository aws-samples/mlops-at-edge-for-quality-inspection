import argparse
import os
import tarfile
import shutil
from ultralytics import YOLO

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--epochs', type=int, default=300)
    parser.add_argument('--batch_size', type=int, default=16, help='total batch size for all GPUs')
    parser.add_argument('--img_size', nargs='+', type=int, default=[450, 450], help='[train, test] image sizes')
    parser.add_argument('--export_to_onnx', type=bool, default=False)
    parser.add_argument('--model_output_dir', type=str, default="/opt/ml/model", help="Directory where to store best model artifact for S3 upload")
    parser.add_argument("--train", type=str, default=os.environ["SM_CHANNEL_TRAIN"])
    parser.add_argument("--validation", type=str, default=os.environ["SM_CHANNEL_VALIDATION"])
    parser.add_argument("--test", type=str, default=os.environ["SM_CHANNEL_TEST"])
    opt = parser.parse_args()

    # Unpack quality inspection dataset tarballs
    tarfile.open(f"{opt.train}/train.tar.gz").extractall(opt.train)
    tarfile.open(f"{opt.validation}/validation.tar.gz").extractall(opt.validation)
    tarfile.open(f"{opt.test}/test.tar.gz").extractall(opt.test)

    # Load a pretrained Ultralytics YOLOv8 model
    model = YOLO('yolov8n.pt')
    
    # Re-train the Ultralytics YOLOv8 model with the quality inspection dataset
    model.train(data='qualityinspection.yaml', epochs=opt.epochs, imgsz=opt.img_size, batch=opt.batch_size)
    metrics = model.val()
    print(f"map:{metrics.box.map}")

    # Export to ONNX if configured
    if opt.export_to_onnx:
        print("Exporting the re-trained Ultralytics YOLOv8 model to ONNX format...")
        model.export(format='onnx', imgsz=opt.img_size, dynamic=True)
    
    print(f"Copying the re-trained Ultralytics YOLOv8 model to {opt.model_output_dir} for S3 upload...")
    shutil.copy(f'runs/detect/train/weights/best.{"onnx" if opt.export_to_onnx else "pt"}', opt.model_output_dir)
        
    
