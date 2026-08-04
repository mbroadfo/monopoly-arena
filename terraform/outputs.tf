# No backend for this app (see terraform/README note in the repo) — api_url and
# lambda_function_name outputs from the spa-on-aws template are omitted entirely,
# since referencing an undeclared resource is a static config error that try()
# does NOT suppress (verified against Terraform 1.11 — it only catches runtime
# errors, not "Reference to undeclared resource").

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID — set as CLOUDFRONT_DIST_ID GitHub Variable"
  value       = aws_cloudfront_distribution.spa.id
}

output "cloudfront_domain" {
  description = "CloudFront domain name (bare) — used as Cloudflare CNAME target"
  value       = aws_cloudfront_distribution.spa.domain_name
}

output "custom_domain_url" {
  description = "App URL — live once ACM validates and Cloudflare CNAME propagates"
  value       = "https://${var.custom_domain}"
}

output "s3_bucket_name" {
  description = "S3 bucket name for SPA assets — set as S3_BUCKET GitHub Variable"
  value       = aws_s3_bucket.spa.id
}
