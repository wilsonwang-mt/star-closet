// 用法：transcode <输入.mp4> <输出.mp4> [时长秒=4] [宽=720] [高=960] [码率bps=3600000]
// 剪裁、缩放并以固定码率重新编码为 H.264（无音频），用于 Live 视频控制在 2MB 内。
import AVFoundation
import CoreMedia

let a = CommandLine.arguments
let src = URL(fileURLWithPath: a[1]), dst = URL(fileURLWithPath: a[2])
let dur = a.count > 3 ? Double(a[3])! : 4
let W = a.count > 4 ? Int(a[4])! : 720, H = a.count > 5 ? Int(a[5])! : 960
let bps = a.count > 6 ? Int(a[6])! : 3_600_000
try? FileManager.default.removeItem(at: dst)

let asset = AVURLAsset(url: src)
let sem = DispatchSemaphore(value: 0)
var failed: String? = nil
Task {
  do {
    let track = try await asset.loadTracks(withMediaType: .video).first!
    let reader = try AVAssetReader(asset: asset)
    reader.timeRange = CMTimeRange(start: .zero, duration: CMTime(seconds: dur, preferredTimescale: 600))
    let out = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    reader.add(out)
    let writer = try AVAssetWriter(outputURL: dst, fileType: .mp4)
    writer.shouldOptimizeForNetworkUse = true
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: W, AVVideoHeightKey: H,
      AVVideoScalingModeKey: AVVideoScalingModeResizeAspectFill,
      AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: bps, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel, AVVideoMaxKeyFrameIntervalKey: 30],
    ])
    input.expectsMediaDataInRealTime = false
    writer.add(input)
    reader.startReading(); writer.startWriting(); writer.startSession(atSourceTime: .zero)
    while let buf = out.copyNextSampleBuffer() {
      while !input.isReadyForMoreMediaData { usleep(2000) }
      input.append(buf)
    }
    input.markAsFinished()
    await writer.finishWriting()
    if writer.status != .completed { failed = writer.error?.localizedDescription ?? "writer failed" }
  } catch { failed = "\(error)" }
  sem.signal()
}
sem.wait()
if let f = failed { FileHandle.standardError.write(f.data(using: .utf8)!); exit(1) }
