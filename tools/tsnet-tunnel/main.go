// tsnet-tunnel: nodo Tailscale in userspace (nessuna installazione di sistema)
// che espone il sidecar Quinki (127.0.0.1:9182) su Funnel con un link stabile:
//
//	https://<hostname>.<tailnet>.ts.net
//
// Niente root, niente daemon, niente app Tailscale sul telefono: il link e'
// pubblico come "porta", ma l'accesso resta protetto dal token di Quinki.
//
// Uso:
//
//	tsnet-tunnel -hostname quinki-7f3a2b -target 127.0.0.1:9182 \
//	             -state-dir ~/.quinki/tsnet -authkey-file ~/.quinki/ts-authkey
//
// Output: una riga JSON per evento su stdout (status: starting|auth-required|
// running|error), cosi' l'app la legge e mostra link/stato.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"tailscale.com/ipn"
	"tailscale.com/tsnet"
)

type statusMsg struct {
	Status  string `json:"status"`
	URL     string `json:"url,omitempty"`
	AuthURL string `json:"authUrl,omitempty"`
	Error   string `json:"error,omitempty"`
}

var emitMu sync.Mutex

func emit(m statusMsg) {
	b, _ := json.Marshal(m)
	emitMu.Lock()
	fmt.Fprintln(os.Stdout, string(b))
	os.Stdout.Sync()
	emitMu.Unlock()
}

func main() {
	hostname := flag.String("hostname", "quinki", "nome del nodo (diventa <nome>.<tailnet>.ts.net)")
	target := flag.String("target", "127.0.0.1:9182", "indirizzo locale del sidecar")
	stateDir := flag.String("state-dir", "", "cartella stato del nodo (identita' persistente)")
	authKeyFile := flag.String("authkey-file", "", "file con la auth key Tailscale")
	flag.Parse()

	if *stateDir == "" {
		home, _ := os.UserHomeDir()
		*stateDir = home + "/.quinki/tsnet"
	}
	os.MkdirAll(*stateDir, 0o700)

	authKey := os.Getenv("TS_AUTHKEY")
	if authKey == "" && *authKeyFile != "" {
		if b, err := os.ReadFile(*authKeyFile); err == nil {
			authKey = strings.TrimSpace(string(b))
		}
	}

	emit(statusMsg{Status: "starting"})

	srv := &tsnet.Server{
		Hostname: *hostname,
		Dir:      *stateDir,
		AuthKey:  authKey,
		Logf:     func(format string, args ...any) {},
		UserLogf: func(format string, args ...any) {},
	}
	defer srv.Close()

	ctx := context.Background()

	// LocalClient chiama Start: da qui in poi il bus IPN e' attivo.
	lc, err := srv.LocalClient()
	if err != nil {
		emit(statusMsg{Status: "error", Error: err.Error()})
		os.Exit(1)
	}

	// Attesa del running: replico tsnet.Up() ma intercettando anche BrowseToURL
	// (il link di login del primo avvio interattivo, che Up() scarterebbe).
	watcher, err := lc.WatchIPNBus(ctx, ipn.NotifyInitialState)
	if err != nil {
		emit(statusMsg{Status: "error", Error: err.Error()})
		os.Exit(1)
	}
	for {
		n, err := watcher.Next()
		if err != nil {
			emit(statusMsg{Status: "error", Error: err.Error()})
			os.Exit(1)
		}
		if n.ErrMessage != nil {
			emit(statusMsg{Status: "error", Error: *n.ErrMessage})
			os.Exit(1)
		}
		if n.BrowseToURL != nil {
			emit(statusMsg{Status: "auth-required", AuthURL: *n.BrowseToURL})
		}
		if n.State != nil && *n.State == ipn.Running {
			break
		}
	}
	watcher.Close()

	// Pulizia di eventuali serve-config stantii (stessa igiene di tsnet.Up).
	_ = lc.SetServeConfig(ctx, new(ipn.ServeConfig))

	st, err := lc.Status(ctx)
	if err != nil {
		emit(statusMsg{Status: "error", Error: err.Error()})
		os.Exit(1)
	}
	fqdn := strings.TrimSuffix(st.Self.DNSName, ".")
	publicURL := "https://" + fqdn

	// Funnel: porta 443 (l'unica "bella" consentita insieme a 8443 e 10000).
	// Se l'utente non ha ancora acceso Funnel nella console, riproviamo ogni 30s
	// invece di uscire: appena accende l'interruttore il link parte da solo.
	var ln net.Listener
	var errLn error
	for {
		ln, errLn = srv.ListenFunnel("tcp", ":443")
		if errLn == nil {
			break
		}
		emit(statusMsg{Status: "funnel-pending"})
		time.Sleep(30 * time.Second)
	}
	// "running" solo quando il Funnel e' davvero attivo: cosi' il link in
	// Impostazioni compare solo quando e' raggiungibile.
	emit(statusMsg{Status: "running", URL: publicURL})

	targetURL := &url.URL{Scheme: "http", Host: *target}
	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(targetURL)
			// Host = hostname pubblico: il sidecar ci costruisce dentro il
			// payload window.__QUINKI__ (server ws/wss) del client web.
			pr.Out.Host = pr.In.Host
			pr.SetXForwarded()
			// Funnel termina il TLS: diciamo al sidecar che siamo in https,
			// cosi' il web client usa wss:// e il cookie Secure resta valido.
			pr.Out.Header.Set("X-Forwarded-Proto", "https")
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			w.WriteHeader(http.StatusBadGateway)
			fmt.Fprintf(w, "quinki tunnel error: %v", err)
		},
	}

	httpSrv := &http.Server{Handler: proxy}
	go func() {
		if err := httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			emit(statusMsg{Status: "error", Error: err.Error()})
			os.Exit(1)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	httpSrv.Shutdown(shutdownCtx)
}
