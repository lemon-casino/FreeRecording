#include "desktop_duplication_session.h"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <utility>

namespace {

bool succeeded(HRESULT hr, const char* label) {
    if (SUCCEEDED(hr)) {
        return true;
    }

    std::cerr << "ERROR: " << label << " failed (hr=0x" << std::hex << hr << std::dec << ")"
              << std::endl;
    return false;
}

int64_t elapsedHns(std::chrono::steady_clock::time_point start) {
    return std::chrono::duration_cast<std::chrono::nanoseconds>(
               std::chrono::steady_clock::now() - start)
               .count() /
           100;
}

} // namespace

DesktopDuplicationSession::~DesktopDuplicationSession() {
    stop();
}

bool DesktopDuplicationSession::findOutputForMonitor(HMONITOR monitor) {
    Microsoft::WRL::ComPtr<IDXGIFactory1> factory;
    if (!succeeded(CreateDXGIFactory1(IID_PPV_ARGS(&factory)), "CreateDXGIFactory1")) {
        return false;
    }

    for (UINT adapterIndex = 0;; adapterIndex += 1) {
        Microsoft::WRL::ComPtr<IDXGIAdapter1> adapter;
        HRESULT adapterResult = factory->EnumAdapters1(adapterIndex, &adapter);
        if (adapterResult == DXGI_ERROR_NOT_FOUND) {
            break;
        }
        if (!succeeded(adapterResult, "EnumAdapters1")) {
            return false;
        }

        for (UINT outputIndex = 0;; outputIndex += 1) {
            Microsoft::WRL::ComPtr<IDXGIOutput> output;
            HRESULT outputResult = adapter->EnumOutputs(outputIndex, &output);
            if (outputResult == DXGI_ERROR_NOT_FOUND) {
                break;
            }
            if (!succeeded(outputResult, "EnumOutputs")) {
                return false;
            }

            DXGI_OUTPUT_DESC desc{};
            if (!succeeded(output->GetDesc(&desc), "IDXGIOutput::GetDesc")) {
                return false;
            }
            if (desc.Monitor != monitor) {
                continue;
            }

            Microsoft::WRL::ComPtr<IDXGIOutput1> output1;
            if (!succeeded(output.As(&output1), "Query IDXGIOutput1")) {
                return false;
            }

            adapter_ = adapter;
            output_ = output1;
            outputDesc_ = desc;
            width_ = static_cast<int>(desc.DesktopCoordinates.right - desc.DesktopCoordinates.left);
            height_ = static_cast<int>(desc.DesktopCoordinates.bottom - desc.DesktopCoordinates.top);
            return width_ > 0 && height_ > 0;
        }
    }

    std::cerr << "ERROR: Could not find DXGI output for monitor" << std::endl;
    return false;
}

bool DesktopDuplicationSession::createD3DDevice() {
    if (!adapter_) {
        std::cerr << "ERROR: Desktop duplication adapter is not resolved" << std::endl;
        return false;
    }

    UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
#if defined(_DEBUG)
    flags |= D3D11_CREATE_DEVICE_DEBUG;
#endif

    D3D_FEATURE_LEVEL featureLevels[] = {
        D3D_FEATURE_LEVEL_11_1,
        D3D_FEATURE_LEVEL_11_0,
        D3D_FEATURE_LEVEL_10_1,
        D3D_FEATURE_LEVEL_10_0,
    };
    D3D_FEATURE_LEVEL featureLevel{};

    HRESULT hr = D3D11CreateDevice(
        adapter_.Get(),
        D3D_DRIVER_TYPE_UNKNOWN,
        nullptr,
        flags,
        featureLevels,
        ARRAYSIZE(featureLevels),
        D3D11_SDK_VERSION,
        &d3dDevice_,
        &featureLevel,
        &d3dContext_);

#if defined(_DEBUG)
    if (FAILED(hr)) {
        flags &= ~D3D11_CREATE_DEVICE_DEBUG;
        hr = D3D11CreateDevice(
            adapter_.Get(),
            D3D_DRIVER_TYPE_UNKNOWN,
            nullptr,
            flags,
            featureLevels,
            ARRAYSIZE(featureLevels),
            D3D11_SDK_VERSION,
            &d3dDevice_,
            &featureLevel,
            &d3dContext_);
    }
#endif

    return succeeded(hr, "D3D11CreateDevice");
}

bool DesktopDuplicationSession::initialize(HMONITOR monitor, int fps) {
    fps_ = fps > 0 ? fps : 60;
    if (!findOutputForMonitor(monitor)) {
        return false;
    }
    if (!createD3DDevice()) {
        return false;
    }
    if (!succeeded(output_->DuplicateOutput(d3dDevice_.Get(), &duplication_), "DuplicateOutput")) {
        return false;
    }

    return true;
}

void DesktopDuplicationSession::setFrameCallback(FrameCallback callback) {
    std::scoped_lock lock(callbackMutex_);
    frameCallback_ = std::move(callback);
}

bool DesktopDuplicationSession::start() {
    if (!duplication_ || started_) {
        return false;
    }

    stopRequested_ = false;
    captureThread_ = std::thread(&DesktopDuplicationSession::captureLoop, this);
    started_ = true;
    return true;
}

void DesktopDuplicationSession::stop() {
    stopRequested_ = true;
    if (captureThread_.joinable()) {
        captureThread_.join();
    }

    duplication_.Reset();
    output_.Reset();
    adapter_.Reset();
    d3dContext_.Reset();
    d3dDevice_.Reset();
    started_ = false;
}

void DesktopDuplicationSession::captureLoop() {
    const auto timelineStart = std::chrono::steady_clock::now();
    const UINT timeoutMs = static_cast<UINT>(std::max(16, 1000 / std::max(1, fps_)));

    while (!stopRequested_) {
        DXGI_OUTDUPL_FRAME_INFO frameInfo{};
        Microsoft::WRL::ComPtr<IDXGIResource> resource;
        const HRESULT acquireResult =
            duplication_->AcquireNextFrame(timeoutMs, &frameInfo, &resource);

        if (acquireResult == DXGI_ERROR_WAIT_TIMEOUT) {
            continue;
        }
        if (acquireResult == DXGI_ERROR_ACCESS_LOST) {
            std::cerr << "ERROR: Desktop duplication access was lost" << std::endl;
            break;
        }
        if (!succeeded(acquireResult, "AcquireNextFrame")) {
            break;
        }

        Microsoft::WRL::ComPtr<ID3D11Texture2D> texture;
        const HRESULT textureResult = resource.As(&texture);
        if (SUCCEEDED(textureResult) && texture) {
            FrameCallback callback;
            {
                std::scoped_lock lock(callbackMutex_);
                callback = frameCallback_;
            }
            if (callback) {
                callback(texture.Get(), elapsedHns(timelineStart));
            }
        } else {
            std::cerr << "ERROR: Failed to query acquired desktop frame texture" << std::endl;
        }

        duplication_->ReleaseFrame();
    }
}

int DesktopDuplicationSession::captureWidth() const {
    return width_;
}

int DesktopDuplicationSession::captureHeight() const {
    return height_;
}

RECT DesktopDuplicationSession::outputRect() const {
    return outputDesc_.DesktopCoordinates;
}

ID3D11Device* DesktopDuplicationSession::device() const {
    return d3dDevice_.Get();
}

ID3D11DeviceContext* DesktopDuplicationSession::context() const {
    return d3dContext_.Get();
}
