variable "environment" {
  description = "Deployment environment — used in resource tags and SSM paths"
  default     = "prod"
}

variable "aws_region" {
  description = "AWS region for all resources (except ACM, which is always us-east-1)"
  default     = "us-west-2"
}

variable "app_name" {
  description = "Short kebab-case name used as a prefix for all AWS resources"
  type        = string
  # Example: "monopoly-arena"
  # S3 bucket is derived as {app_name}-assets
}

variable "custom_domain" {
  description = "Custom domain to serve the SPA from (must be in your Cloudflare zone)"
  type        = string
  # Example: "arena.xaminisalamini.com"
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for the domain"
  type        = string
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with Zone:DNS:Edit on the zone"
  type        = string
  sensitive   = true
}

variable "price_class" {
  description = "CloudFront price class — PriceClass_100 (US+EU), PriceClass_200 (+Asia), PriceClass_All"
  default     = "PriceClass_100"
}
