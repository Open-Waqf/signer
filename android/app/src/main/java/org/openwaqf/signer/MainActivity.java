package org.openwaqf.signer;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // "Share to Signer" from another app arrives as ACTION_SEND with the PDF in EXTRA_STREAM.
    // Capacitor only reports ACTION_VIEW links ("Open with") to the web app, so a shared PDF
    // used to open an empty home screen. Turn the share into an "Open with" first; the
    // read permission Android granted for the shared file still applies.
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        shareToView(getIntent());
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        shareToView(intent);
        super.onNewIntent(intent);
    }

    private static void shareToView(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        Uri stream = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class)
                : intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (stream == null) return;
        intent.setAction(Intent.ACTION_VIEW);
        intent.setDataAndType(stream, intent.getType() != null ? intent.getType() : "application/pdf");
    }
}
