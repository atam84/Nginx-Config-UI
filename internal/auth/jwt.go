package auth

import (
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// Claims holds JWT claims.
type Claims struct {
	Username string `json:"username"`
	jwt.RegisteredClaims
}

// Config holds auth configuration.
type Config struct {
	Secret       []byte
	Username     string
	PasswordHash string
	Disabled     bool
}

// FromEnv loads auth config from environment.
// Set AUTH_DISABLED=1 to disable auth (dev). Use AUTH_PASSWORD_HASH (bcrypt) or AUTH_PASSWORD (plain, less secure).
func FromEnv() Config {
	cfg := Config{
		Secret:       []byte(os.Getenv("JWT_SECRET")),
		Username:     os.Getenv("AUTH_USERNAME"),
		PasswordHash: os.Getenv("AUTH_PASSWORD_HASH"),
		Disabled:     os.Getenv("AUTH_DISABLED") == "1" || os.Getenv("AUTH_DISABLED") == "true",
	}
	if len(cfg.Secret) == 0 {
		cfg.Secret = []byte("change-me-in-production")
	}
	if plain := os.Getenv("AUTH_PASSWORD"); plain != "" && cfg.PasswordHash == "" {
		if h, err := HashPassword(plain); err == nil {
			cfg.PasswordHash = h
		}
	}
	return cfg
}

// HashPassword returns bcrypt hash of password.
func HashPassword(password string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(h), err
}

// CheckPassword verifies password against hash.
func CheckPassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// Middleware returns a Gin middleware that validates JWT.
func Middleware(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.Disabled {
			c.Next()
			return
		}
		// Only protect /api/* (except /api/auth/*)
		p := c.Request.URL.Path
		if !strings.HasPrefix(p, "/api") || strings.HasPrefix(p, "/api/auth") {
			c.Next()
			return
		}
		auth := c.GetHeader("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "missing or invalid Authorization header",
			})
			return
		}
		tokenStr := strings.TrimPrefix(auth, "Bearer ")
		var claims Claims
		token, err := jwt.ParseWithClaims(tokenStr, &claims, func(t *jwt.Token) (interface{}, error) {
			return cfg.Secret, nil
		})
		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "invalid token",
			})
			return
		}
		c.Set("username", claims.Username)
		c.Next()
	}
}

// IssueToken creates a JWT for the given username.
func IssueToken(cfg Config, username string) (string, error) {
	claims := Claims{
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(cfg.Secret)
}

// LoginHandler returns a handler for POST /api/auth/login.
func LoginHandler(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.Disabled {
			c.JSON(http.StatusOK, gin.H{"token": "", "message": "auth disabled"})
			return
		}
		var req struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
		if cfg.Username == "" || cfg.PasswordHash == "" {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "auth not configured"})
			return
		}
		if req.Username != cfg.Username || !CheckPassword(req.Password, cfg.PasswordHash) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
			return
		}
		token, err := IssueToken(cfg, req.Username)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create token"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"token": token})
	}
}
