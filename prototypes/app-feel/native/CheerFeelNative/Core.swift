// 小樣（#300，比完就丟）：用系統的 JavaScriptCore 跑跟網頁、伺服器同一包流程核心（flow-core.js，build.sh 打包放進來）。
import Foundation
import JavaScriptCore

final class Core {
    private let ctx = JSContext()!
    private(set) var ids: [String] = []
    var error: String?

    init() {
        ctx.isInspectable = true
        ctx.exceptionHandler = { [weak self] _, e in self?.error = e?.toString() }
        let src = try! String(contentsOf: Bundle.main.url(forResource: "flow-core", withExtension: "js")!, encoding: .utf8)
        ctx.evaluateScript(src + "\n;globalThis.flowCore = flowCore;")
        ctx.evaluateScript("""
        globalThis.app = {
          flow: null, audio: null,
          read(bytes) {
            const r = flowCore.readFlowFile(bytes);
            if (r.kind !== 'ok') return JSON.stringify(r);
            app.flow = r.flow; app.audio = r.audio; return null;
          },
          setFlow(json) { app.flow = JSON.parse(json); },
          flowJson() { return JSON.stringify(app.flow); },
          ids() { return app.flow.members.map((m) => m.id); },
          audioFiles() { return app.flow.audio.map((a) => [a.id, a.file]); },
          pos(sec) {
            const p = flowCore.positionsAt(app.flow, sec);
            const out = [];
            for (const m of app.flow.members) { const q = p[m.id]; out.push(q ? q[0] : 0, q ? q[1] : 0); }
            return out;
          },
          clips(sec) { return JSON.stringify(flowCore.playbackPlan(app.flow, sec).clips); },
          bpm() { const s = app.flow.segments.find((s) => s.kind === 'music'); return s ? s.bpm : 120; },
          total() { return flowCore.playbackPlan(app.flow, 0).endSec; },
          move(sec, id, x, y, step) {
            const r = flowCore.runCommands(app.flow, [{ name: 'moveMembers', args: [sec, { [id]: [x, y] }] }], step);
            if (r.kind === 'ok') app.flow = r.flow;
            return r.kind;
          },
        };
        """)
    }

    private var app: JSValue { ctx.objectForKeyedSubscript("app") }

    /// 打開流程檔（zip 的位元組）。回音樂檔：id → 位元組；打不開回 nil。
    func read(_ data: Data) -> [String: Data]? {
        let g = ctx.jsGlobalContextRef
        let buf = UnsafeMutableRawPointer.allocate(byteCount: max(data.count, 1), alignment: 16)
        data.copyBytes(to: buf.assumingMemoryBound(to: UInt8.self), count: data.count)
        let arr = JSObjectMakeTypedArrayWithBytesNoCopy(g, kJSTypedArrayTypeUint8Array, buf, data.count, { p, _ in p?.deallocate() }, nil, nil)
        let r = app.invokeMethod("read", withArguments: [JSValue(jsValueRef: arr, in: ctx)!])
        if let r, !r.isNull { error = r.toString(); return nil }
        ids = app.invokeMethod("ids", withArguments: [])!.toArray() as! [String]
        var out: [String: Data] = [:]
        let audio = app.objectForKeyedSubscript("audio")!
        for key in audio.toDictionary().keys {
            let id = key as! String
            let ref = JSValueToObject(g, audio.objectForKeyedSubscript(id).jsValueRef, nil)
            let p = JSObjectGetTypedArrayBytesPtr(g, ref, nil)!
            out[id] = Data(bytes: p, count: JSObjectGetTypedArrayByteLength(g, ref, nil))
        }
        app.setObject(NSNull(), forKeyedSubscript: "audio" as NSString)
        return out
    }

    func setFlow(_ json: String) {
        app.invokeMethod("setFlow", withArguments: [json])
        ids = app.invokeMethod("ids", withArguments: [])!.toArray() as! [String]
    }
    func flowJson() -> String { app.invokeMethod("flowJson", withArguments: [])!.toString() }
    func audioFiles() -> [(String, String)] {
        (app.invokeMethod("audioFiles", withArguments: [])!.toArray() as! [[String]]).map { ($0[0], $0[1]) }
    }
    func positions(_ sec: Double) -> [Double] { app.invokeMethod("pos", withArguments: [sec])!.toArray() as! [Double] }
    func clips(_ sec: Double) -> [[String: Any]] {
        let s = app.invokeMethod("clips", withArguments: [sec])!.toString()!
        return try! JSONSerialization.jsonObject(with: Data(s.utf8)) as! [[String: Any]]
    }
    func bpm() -> Double { app.invokeMethod("bpm", withArguments: [])!.toDouble() }
    func total() -> Double { app.invokeMethod("total", withArguments: [])!.toDouble() }
    func move(sec: Double, id: String, x: Double, y: Double) -> String {
        app.invokeMethod("move", withArguments: [sec, id, x, y, UUID().uuidString])!.toString()
    }
}
