package io.github.kyj5482.wordguess;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 게임 중 화면 꺼짐 방지 — WebView에는 navigator.wakeLock이 없어 네이티브로 처리.
        // 이마에 폰을 대고 있는 동안 터치가 없어도 화면이 유지되어야 한다.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
