// ESP32-S3 FSR Web Server Alert System
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>

// --- WIFI CREDENTIALS ---
const char* ssid     = "Eden";     // Enter your Wi-Fi SSID
const char* password = "pasarbaru"; // Enter your Wi-Fi Password

// --- PIN DEFINITIONS & TIMINGS ---
const int FSR_PIN = 4;                // Analog input pin connected to FSR module AOUT
const int RGB_LED_PIN = 48;           // Onboard RGB LED GPIO
const int PRESSURE_THRESHOLD = 500;   // Threshold value (0-4095)
const unsigned long ALARM_DELAY = 120000; // 120 seconds in milliseconds

// --- GLOBAL VARIABLES ---
unsigned long doorOpenedStartTime = 0;
bool doorIsOpen = false;
bool alarmTriggered = false;
int currentSensorValue = 0;

WebServer server(80); // Start web server on standard HTTP port 80

// Serve the HTML Web Interface
void handleRoot() {
  String html = "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width, initial-scale=1'>";
  html += "<title>ESP32 Door Monitor</title>";
  html += "<style>body{font-family:Arial,sans-serif;text-align:center;margin-top:50px;background:#f4f4f9;}";
  html += ".card{background:white;padding:30px;display:inline-block;border-radius:10px;box-shadow:0 4px 8px rgba(0,0,0,0.1);}";
  html += ".value{font-size:48px;font-weight:bold;color:#333;}";
  html += ".status{font-size:24px;margin-top:15px;padding:10px;border-radius:5px;}";
  html += ".ok{background:#d4edda;color:#155724;} .alert{background:#f8d7da;color:#721c24;} .open{background:#fff3cd;color:#856404;}</style>";
  html += "<script>setInterval(function(){fetch('/data').then(r=>r.json()).then(d=>{";
  html += "document.getElementById('val').innerText = d.fsr;";
  html += "let st = document.getElementById('st');";
  html += "if(d.alarm){st.innerText='ALERT: Door Open > 15s!'; st.className='status alert';}";
  html += "else if(d.open){st.innerText='Door Open'; st.className='status open';}";
  html += "else{st.innerText='Door Closed'; st.className='status ok';}";
  html += "});}, 500);</script></head><body>";
  html += "<div class='card'><h2>ESP32-S3 Door Monitor</h2>";
  html += "<div>Current FSR Reading:</div><div class='value' id='val'>--</div>";
  html += "<div id='st' class='status ok'>Loading...</div></div></body></html>";

  server.send(200, "text/html", html);
}

// JSON Endpoint for JavaScript live updates
void handleData() {
  String json = "{\"fsr\":" + String(currentSensorValue) + 
                ",\"open\":" + String(doorIsOpen ? "true" : "false") + 
                ",\"alarm\":" + String(alarmTriggered ? "true" : "false") + "}";
  server.send(200, "application/json", json);
}

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 3000);

  pinMode(FSR_PIN, INPUT);
  neopixelWrite(RGB_LED_PIN, 0, 0, 0);

  // Connect to Wi-Fi
  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWi-Fi Connected!");
  Serial.print("Share this IP address with your friend: http://");
  Serial.println(WiFi.localIP());

  // Define Server Routes
  server.on("/", handleRoot);
  server.on("/data", handleData);
  server.begin();
}

void loop() {
  server.handleClient(); // Process incoming web requests

  currentSensorValue = analogRead(FSR_PIN);

  if (currentSensorValue > PRESSURE_THRESHOLD) {
    if (!doorIsOpen) {
      doorIsOpen = true;
      doorOpenedStartTime = millis();
      alarmTriggered = false;
      Serial.println("Door opened.");
    } 
    else if (!alarmTriggered && (millis() - doorOpenedStartTime >= ALARM_DELAY)) {
      Serial.println("Home Alert System: Door opened for prolonged period!");
      alarmTriggered = true;
      neopixelWrite(RGB_LED_PIN, 255, 0, 0); 
    }
  } 
  else {
    if (doorIsOpen) {
      doorIsOpen = false;
      alarmTriggered = false;
      Serial.println("Door closed. Alarm reset.");
      neopixelWrite(RGB_LED_PIN, 0, 0, 0); 
    }
  }

  delay(10); // Short delay to keep WebServer responsive
}