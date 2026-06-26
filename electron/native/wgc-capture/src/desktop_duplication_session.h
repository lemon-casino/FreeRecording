#pragma once

#include <Windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <wrl/client.h>

#include <atomic>
#include <functional>
#include <mutex>
#include <thread>

class DesktopDuplicationSession {
public:
    using FrameCallback = std::function<void(ID3D11Texture2D*, int64_t)>;

    DesktopDuplicationSession() = default;
    ~DesktopDuplicationSession();

    DesktopDuplicationSession(const DesktopDuplicationSession&) = delete;
    DesktopDuplicationSession& operator=(const DesktopDuplicationSession&) = delete;

    bool initialize(HMONITOR monitor, int fps);
    void setFrameCallback(FrameCallback callback);
    bool start();
    void stop();

    int captureWidth() const;
    int captureHeight() const;
    RECT outputRect() const;
    ID3D11Device* device() const;
    ID3D11DeviceContext* context() const;

private:
    bool findOutputForMonitor(HMONITOR monitor);
    bool createD3DDevice();
    void captureLoop();

    Microsoft::WRL::ComPtr<IDXGIAdapter1> adapter_;
    Microsoft::WRL::ComPtr<IDXGIOutput1> output_;
    Microsoft::WRL::ComPtr<IDXGIOutputDuplication> duplication_;
    Microsoft::WRL::ComPtr<ID3D11Device> d3dDevice_;
    Microsoft::WRL::ComPtr<ID3D11DeviceContext> d3dContext_;
    DXGI_OUTPUT_DESC outputDesc_{};
    FrameCallback frameCallback_;
    std::mutex callbackMutex_;
    std::thread captureThread_;
    std::atomic<bool> stopRequested_ = false;
    int width_ = 0;
    int height_ = 0;
    int fps_ = 60;
    bool started_ = false;
};
