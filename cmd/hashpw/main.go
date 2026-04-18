package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/xenos/nginx-config-ui/internal/auth"
)

func main() {
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && line == "" {
		fmt.Fprintln(os.Stderr, "error: empty input on stdin")
		os.Exit(1)
	}
	pw := strings.TrimRight(line, "\r\n")
	if pw == "" {
		fmt.Fprintln(os.Stderr, "error: empty password")
		os.Exit(1)
	}
	hash, err := auth.HashPassword(pw)
	if err != nil {
		fmt.Fprintln(os.Stderr, "hash error:", err)
		os.Exit(1)
	}
	fmt.Println(hash)
}
