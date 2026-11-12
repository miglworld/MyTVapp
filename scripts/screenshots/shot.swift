// Loads a page in the system web view at a fixed size, waits, and saves a PNG.
// usage: shot <url> <out.png> <seconds> [width] [height]
import Cocoa
import WebKit

final class Shot: NSObject, WKNavigationDelegate {
    let web: WKWebView
    let window: NSWindow
    let out: String
    let wait: Double

    init(url: URL, out: String, wait: Double, width: CGFloat, height: CGFloat) {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .nonPersistent()
        cfg.mediaTypesRequiringUserActionForPlayback = []
        let frame = NSRect(x: 0, y: 0, width: width, height: height)
        web = WKWebView(frame: frame, configuration: cfg)
        window = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: width, height: height),
                          styleMask: [.borderless], backing: .buffered, defer: false)
        self.out = out
        self.wait = wait
        super.init()
        web.navigationDelegate = self
        window.contentView = web
        window.orderFrontRegardless()
        web.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
            let c = WKSnapshotConfiguration()
            c.rect = webView.bounds
            c.snapshotWidth = NSNumber(value: Double(webView.bounds.width))
            webView.takeSnapshot(with: c) { image, error in
                guard let image = image, let tiff = image.tiffRepresentation,
                      let rep = NSBitmapImageRep(data: tiff),
                      let png = rep.representation(using: .png, properties: [:]) else {
                    FileHandle.standardError.write("snapshot failed: \(String(describing: error))\n".data(using: .utf8)!)
                    exit(1)
                }
                try? png.write(to: URL(fileURLWithPath: self.out))
                print("saved \(self.out) \(rep.pixelsWide)x\(rep.pixelsHigh)")
                exit(0)
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        FileHandle.standardError.write("load failed: \(error)\n".data(using: .utf8)!); exit(1)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        FileHandle.standardError.write("load failed: \(error)\n".data(using: .utf8)!); exit(1)
    }
}

let args = CommandLine.arguments
guard args.count >= 4, let url = URL(string: args[1]), let wait = Double(args[3]) else {
    print("usage: shot <url> <out.png> <seconds> [width] [height]"); exit(2)
}
let width = args.count > 4 ? CGFloat(Double(args[4]) ?? 1920) : 1920
let height = args.count > 5 ? CGFloat(Double(args[5]) ?? 1080) : 1080
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let shot = Shot(url: url, out: args[2], wait: wait, width: width, height: height)
DispatchQueue.main.asyncAfter(deadline: .now() + wait + 30) { FileHandle.standardError.write("timed out\n".data(using: .utf8)!); exit(3) }
app.run()
