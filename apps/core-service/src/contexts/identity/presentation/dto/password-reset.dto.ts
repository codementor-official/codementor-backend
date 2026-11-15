import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail() @MaxLength(254) email!: string;
}

export class ResetTokenDto {
  @IsString() @Length(20, 200) token!: string;
}

export class ChangePasswordDto {
  @IsString() @Length(1, 128) currentPassword!: string;
  @IsString() @Length(8, 128) newPassword!: string;
}

export class ResetPasswordDto extends ResetTokenDto {
  /** Same floor as sign-up; the realm's password policy may ask for more. */
  @IsString() @Length(8, 128) password!: string;
}
