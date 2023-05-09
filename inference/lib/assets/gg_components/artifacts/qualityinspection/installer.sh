# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

#!/bin/bash
install_lib() {
    py_lib="${1}"
    module="${2}"
    command=$(
        cat <<END
try:
    import $module
except Exception as e:
    print(e)
END
    )
    # Install if the module doesn't already exist
    import_output=$(python3 -c "$command")
    if [[ "$import_output" == *"No module named "* ]]; then
        echo "Installing $py_lib..."
        pip3 install "$py_lib" --user --no-cache-dir
    else
        echo "Skipping $py_lib installation as it already exists."
    fi
}

install_lib "opencv-python" "cv2"
install_lib "numpy" "numpy"
install_lib "ultralytics" "ultralytics"
install_lib "awsiotsdk" "awsiot"
install_lib "cbor2" "cbor2" #GGv2 Stream Manager req
install_lib "sysv_ipc" "sysv_ipc"
