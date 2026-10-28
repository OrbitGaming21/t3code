// Streams microphone dictation as JSON lines on stdout until stdin closes or receives "stop".
// Events: {"type":"ready"}, {"type":"partial","text":...}, {"type":"final","text":...}, {"type":"error","message":...}
import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ event: [String: String]) {
  guard let data = try? JSONSerialization.data(withJSONObject: event),
    let line = String(data: data, encoding: .utf8)
  else { return }
  print(line)
}

func fail(_ message: String) -> Never {
  emit(["type": "error", "message": message])
  exit(1)
}

let locale = CommandLine.arguments.count > 1 ? Locale(identifier: CommandLine.arguments[1]) : Locale.current
guard let recognizer = SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer() else {
  fail("Speech recognition is not available for this language.")
}

let engine = AVAudioEngine()
let request = SFSpeechAudioBufferRecognitionRequest()
request.shouldReportPartialResults = true
request.addsPunctuation = true
if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }

var task: SFSpeechRecognitionTask?
var finished = false

func finish(_ text: String) {
  if finished { return }
  finished = true
  emit(["type": "final", "text": text])
  exit(0)
}

func stopListening() {
  engine.stop()
  engine.inputNode.removeTap(onBus: 0)
  request.endAudio()
  // Recognition normally delivers a final result shortly after endAudio.
  DispatchQueue.main.asyncAfter(deadline: .now() + 3) { finish(latestText) }
}

var latestText = ""

func start() {
  let input = engine.inputNode
  let format = input.outputFormat(forBus: 0)
  guard format.sampleRate > 0 else { fail("No microphone is available.") }
  input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
  do {
    engine.prepare()
    try engine.start()
  } catch {
    fail("Could not start the microphone.")
  }
  task = recognizer.recognitionTask(with: request) { result, error in
    DispatchQueue.main.async {
      if let result {
        latestText = result.bestTranscription.formattedString
        if result.isFinal { finish(latestText) } else { emit(["type": "partial", "text": latestText]) }
      } else if error != nil, !finished {
        if latestText.isEmpty { fail("Could not recognize speech.") } else { finish(latestText) }
      }
    }
  }
  emit(["type": "ready"])
}

DispatchQueue.global().async {
  while let line = readLine() {
    if line.trimmingCharacters(in: .whitespaces) == "stop" { break }
  }
  DispatchQueue.main.async { stopListening() }
}

SFSpeechRecognizer.requestAuthorization { status in
  DispatchQueue.main.async {
    guard status == .authorized else {
      fail("Allow T3 Code under System Settings → Privacy & Security → Speech Recognition.")
    }
    AVCaptureDevice.requestAccess(for: .audio) { granted in
      DispatchQueue.main.async {
        guard granted else {
          fail("Allow T3 Code under System Settings → Privacy & Security → Microphone.")
        }
        start()
      }
    }
  }
}

dispatchMain()
