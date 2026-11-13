import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '@codementor/platform';
import { PasswordResetService } from '../application/password-reset.service';
import { ForgotPasswordDto, ResetPasswordDto, ResetTokenDto } from './dto/password-reset.dto';

/** Caddy replaces X-Forwarded-For with the real client; Kong appends itself after it. */
function clientIp(req: Request): string {
  return String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.ip || 'unknown';
}

/**
 * Forgot / reset password on CodeMentor's pages. Public because the caller cannot sign in.
 * Under `system/` so the existing Kong route reaches it.
 */
@ApiTags('identity')
@Controller({ path: 'system/password-reset', version: '1' })
export class PasswordResetController {
  constructor(private readonly reset: PasswordResetService) {}

  @Public()
  @Post('request')
  @HttpCode(202)
  @ApiOperation({ summary: 'Email a reset link if the address has an account (same answer either way)' })
  async request(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.reset.request(dto.email, clientIp(req));
    return { accepted: true };
  }

  @Public()
  @Post('check')
  @HttpCode(200)
  @ApiOperation({ summary: 'Whether a reset link still works, with the masked email it is for' })
  check(@Body() dto: ResetTokenDto, @Req() req: Request) {
    return this.reset.check(dto.token, clientIp(req));
  }

  @Public()
  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Set a new password with a reset link; signs the account out everywhere' })
  set(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.reset.reset(dto.token, dto.password, clientIp(req));
  }
}
