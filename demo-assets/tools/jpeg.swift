// 用法：jpeg <输入> <输出> <质量0-1>：用 ImageIO 按指定质量重新编码 JPEG（sips 的数字质量参数在本机无效）。
import Foundation
import ImageIO
import UniformTypeIdentifiers
let a = CommandLine.arguments
let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: a[1]) as CFURL, nil)!
let img = CGImageSourceCreateImageAtIndex(src, 0, nil)!
let dst = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[2]) as CFURL, UTType.jpeg.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dst, img, [kCGImageDestinationLossyCompressionQuality: Double(a[3])!] as CFDictionary)
exit(CGImageDestinationFinalize(dst) ? 0 : 1)
